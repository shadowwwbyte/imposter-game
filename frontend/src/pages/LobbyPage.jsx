import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play, Pause, Settings, Copy, ArrowLeft,
  Mic, MicOff, Send, Smile, X, Volume2,
  Crown, WifiOff, Vote, Eye, SkipForward, Timer, MessageSquare
} from 'lucide-react';
import api from '../utils/api';
import { useAuthStore } from '../store/authStore';
import { useSocketStore } from '../store/socketStore';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const REACTIONS = ['👍','❤️','😂','😮','🔥','🎮','🕵️','💀'];

export default function LobbyPage() {
  const { code } = useParams();
  const { user } = useAuthStore();
  const { getSocket, onlineUsers } = useSocketStore();
  const navigate = useNavigate();

  const [lobby, setLobby]                   = useState(null);
  const [messages, setMessages]             = useState([]);
  const [text, setText]                     = useState('');
  const [loading, setLoading]               = useState(true);
  const [myRole, setMyRole]                 = useState(null);
  const [myWord, setMyWord]                 = useState(null);
  const [imposterCount, setImposterCount]   = useState(0);
  const [voting, setVoting]                 = useState(false);
  const [myVote, setMyVote]                 = useState(null);
  const [voteResults, setVoteResults]       = useState({});
  const [gameResult, setGameResult]         = useState(null);
  const [paused, setPaused]                 = useState(false);
  const [pauseInfo, setPauseInfo]           = useState(null);
  const [disconnectedUsers, setDisconnectedUsers] = useState([]);
  const [replyTo, setReplyTo]               = useState(null);
  const [recording, setRecording]           = useState(false);
  const [liveAudioUsers, setLiveAudioUsers] = useState([]);
  const [showSettings, setShowSettings]     = useState(false);
  const [settings, setSettings]             = useState({ turnTime: 30, maxPlayers: 10 });
  const [showWordGuess, setShowWordGuess]   = useState(false);
  const [wordGuess, setWordGuess]           = useState('');
  const [typingUsers, setTypingUsers]       = useState([]);
  const [showReactionPicker, setShowReactionPicker] = useState(null);

  // ── Turn state ──────────────────────────────────────────────────────────
  const [currentTurnUserId, setCurrentTurnUserId]     = useState(null);
  const [currentTurnUsername, setCurrentTurnUsername] = useState(null);
  const [turnTimeLeft, setTurnTimeLeft]               = useState(0);
  const [turnRound, setTurnRound]                     = useState(1);

  // ── Hint state ───────────────────────────────────────────────────────────
  // playerHints: { [userId]: string[] }  — ALL hints per player across all rounds
  const [playerHints, setPlayerHints]   = useState({});
  const [hintInput, setHintInput]       = useState('');
  const [showHintCard, setShowHintCard] = useState(false); // flashcard modal
  const [mustGuess, setMustGuess]         = useState(false);  // imposter final guess prompt
  const [finalGuessPlayer, setFinalGuessPlayer] = useState(null); // { imposterId, imposterName }
  const [showVoteCard, setShowVoteCard]     = useState(false);  // voting flashcard
  const [voteCardPlayers, setVoteCardPlayers] = useState([]);   // active non-eliminated players for vote card
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false); // explicit leave confirmation
  const [mobileTab, setMobileTab] = useState('chat'); // 'players' | 'chat' — mobile only, default chat
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  const messagesEndRef   = useRef(null);
  const mediaRecorderRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const turnTimerRef     = useRef(null);
  const turnTimeLeftRef  = useRef(0);
  const hintInputRef        = useRef(null);
  const finalGuessPendingRef = useRef(false); // ref so socket closures always get fresh value

  const isHost        = lobby?.host_id === user.id;
  const me            = lobby?.players?.find(p => p.id === user.id);
  const activePlayers = lobby?.players?.filter(p => !p.is_eliminated) || [];
  const isMyTurn      = currentTurnUserId === user.id;
  const isPlaying     = lobby?.status === 'playing';
  const isWaiting     = lobby?.status === 'waiting';
  const isPaused      = paused;

  const scrollBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchLobby = async () => {
    try {
      const { data } = await api.get(`/lobby/${code}`);
      setLobby(data);
      setPaused(data.status === 'paused');
      setSettings({ turnTime: data.turn_time, maxPlayers: data.max_players });

      // Restore game state if rejoining a game in progress
      if (data.status === 'playing' || data.status === 'paused') {
        const me = (data.players || []).find(p => p.id === user.id);
        if (me && me.assigned_word && !myWord) {
          // Player rejoined mid-game — restore their role and word
          setMyRole(me.role);
          setMyWord(me.assigned_word);
        }
      }
    } catch {
      toast.error('Lobby not found');
      navigate('/games');
    }
    setLoading(false);
  };

  const fetchMessages = async () => {
    try {
      const { data } = await api.get(`/lobby/${code}/messages`).catch(() => ({ data: [] }));
      setMessages(data);
      setTimeout(scrollBottom, 100);
    } catch {}
  };

  useEffect(() => { fetchLobby(); fetchMessages(); }, [code]);

  // Re-join lobby socket room and restore state on reconnect
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onReconnect = () => {
      socket.emit('lobby:join', { code });
      socket.emit('user:reconnect', { code });
      fetchLobby();  // restore full game state
    };
    socket.on('connect', onReconnect);
    return () => socket.off('connect', onReconnect);
  }, [code, getSocket]);

  // Track mobile breakpoint reactively
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Turn timer ────────────────────────────────────────────────────────────
  const startTurnTimer = useCallback((seconds) => {
    clearInterval(turnTimerRef.current);
    setTurnTimeLeft(seconds);
    turnTimeLeftRef.current = seconds;

    turnTimerRef.current = setInterval(() => {
      turnTimeLeftRef.current -= 1;
      setTurnTimeLeft(turnTimeLeftRef.current);
      if (turnTimeLeftRef.current <= 0) {
        clearInterval(turnTimerRef.current);
        getSocket()?.emit('game:turnDone', { code });
      }
    }, 1000);
  }, [code, getSocket]);

  const stopTurnTimer = useCallback(() => {
    clearInterval(turnTimerRef.current);
    setTurnTimeLeft(0);
  }, []);

  useEffect(() => () => clearInterval(turnTimerRef.current), []);

  // Show flashcard when it becomes my turn
  useEffect(() => {
    // Don't show hint card if final-guess phase or voting is happening
    if (isMyTurn && isPlaying && !isPaused && !finalGuessPlayer && !voting) {
      setHintInput('');
      setShowHintCard(true);
      setTimeout(() => hintInputRef.current?.focus(), 100);
    } else {
      setShowHintCard(false);
    }
  }, [isMyTurn, isPlaying, isPaused, finalGuessPlayer, voting]);

  // ── System message helper (NOT in chat — separate) ────────────────────────
  const addSystemMsg = (content) => {
    setMessages(m => [...m, {
      id: `sys-${Date.now()}-${Math.random()}`,
      content,
      message_type: 'system',
      created_at: new Date().toISOString(),
    }]);
    setTimeout(scrollBottom, 50);
  };

  // ── Socket events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('lobby:join', { code });

    const handlers = {
      // Update individual player's online status inside this lobby
      'user:statusChange': ({ userId, status }) => {
        setLobby(l => l ? {
          ...l,
          players: (l.players || []).map(p =>
            p.id === userId ? { ...p, status } : p
          )
        } : l);
      },

      'lobby:playerJoined': ({ userId, username, avatar_color }) => {
        setLobby(l => l ? {
          ...l,
          players: [...(l.players || []).filter(p => p.id !== userId),
            { id: userId, username, avatar_color, is_eliminated: false }]
        } : l);
        // silently update player list — no chat log for join
      },
      'lobby:playerLeft': ({ userId }) => {
        setLobby(l => l ? { ...l, players: (l.players || []).filter(p => p.id !== userId) } : l);
      },
      'lobby:hostChanged': ({ newHostId }) => {
        setLobby(l => l ? { ...l, host_id: newHostId } : l);
      },
      'lobby:settingsUpdated': (updated) => {
        setLobby(l => ({ ...l, ...updated }));
        setSettings({ turnTime: updated.turn_time, maxPlayers: updated.max_players });
        addSystemMsg('Host updated lobby settings');
      },

      // ── Chat messages (lobby chat only) ──
      'lobby:message': (msg) => {
        setMessages(m => [...m, msg]);
        setTimeout(scrollBottom, 50);
      },
      'lobby:reaction': ({ messageId, reactions }) => {
        setMessages(m => m.map(msg => msg.id === messageId ? { ...msg, reactions } : msg));
      },
      'lobby:typing': ({ userId: uid, username, isTyping }) => {
        if (uid === user.id) return;
        setTypingUsers(t => isTyping
          ? [...t.filter(u => u.id !== uid), { id: uid, username }]
          : t.filter(u => u.id !== uid));
      },
      'lobby:audioStreamStart': ({ userId: uid, username }) => {
        setLiveAudioUsers(u => [...u.filter(x => x.id !== uid), { id: uid, username }]);
      },
      'lobby:audioStreamEnd': ({ userId: uid }) => {
        setLiveAudioUsers(u => u.filter(x => x.id !== uid));
      },

      // ── Hint submitted by a player ──
      // Shown next to player name — NOT in chat
      'game:hintSubmitted': ({ userId: uid, hint }) => {
        setPlayerHints(h => ({
          ...h,
          [uid]: [...(h[uid] || []), hint],  // append, keep all rounds' hints
        }));
      },

      // ── Turn events ──
      'game:turnChanged': ({ currentTurnUserId: uid, currentTurnUsername: uname, turnTime, isNewRound, roundNumber }) => {
        setCurrentTurnUserId(uid);
        setCurrentTurnUsername(uname);
        setTurnRound(roundNumber);
        startTurnTimer(turnTime);
        // Clear hints at the start of each new round
        // isNewRound — round counter is shown in the turn bar, no need for a chat log
      },

      'game:turnDone': ({ userId: uid }) => {
        // Use ref so this closure always reads the latest value
        if (isHost && !finalGuessPendingRef.current) {
          setTimeout(() => {
            getSocket()?.emit('game:nextTurn', { code, currentTurnUserId: uid });
          }, 800);
        }
      },

      // ── Game events ──
      'game:started': ({ role, word, imposterCount: ic, totalPlayers }) => {
        setMyRole(role);
        setMyWord(word);
        setImposterCount(ic);
        setGameResult(null);
        setVoting(false);
        setMyVote(null);
        setVoteResults({});
        setPlayerHints({});
        setTurnRound(1);
        fetchLobby();
        // game:announcement fires the start message — no duplicate here
      },
      'game:announcement': ({ message }) => addSystemMsg(message),

      'game:votingStarted': ({ message, auto }) => {
        setVoting(true);
        setMyVote(null);
        setVoteResults({});
        stopTurnTimer();
        setCurrentTurnUserId(null);
        setShowHintCard(false);
        addSystemMsg(message || '🗳️ Time to vote!');
        // Open vote flashcard for all active non-eliminated players
        setShowVoteCard(true);
        if (auto) toast('🗳️ Voting time!', { duration: 3000 });
      },
      'game:voteReceived': ({ totalVotes, totalPlayers, votedForId }) => {
        // Just update vote counts — no per-vote log message (too noisy)
        setVoteResults(v => ({ ...v, [votedForId]: (v[votedForId] || 0) + 1 }));
      },
      'game:voteTie': ({ message, tiedPlayers }) => {
        // Show who was tied before re-vote
        if (Array.isArray(tiedPlayers) && tiedPlayers.length > 0) {
          const names = tiedPlayers.map(p => p.username).join(' & ');
          addSystemMsg(`⚖️ Tie between ${names} — vote again!`);
          setRevealedVotes({ tally: Object.fromEntries(tiedPlayers.map(p => [p.username, p.votes])), tied: true, tiedNames: names });
          setShowVotePopup(true);
        } else {
          addSystemMsg(`⚖️ ${message}`);
        }
        setVoting(true); setMyVote(null); setVoteResults({});
        // Reopen vote card for EVERYONE after popup
        setTimeout(() => { setShowVotePopup(false); setShowVoteCard(true); }, 2500);
      },
      'game:playerEliminated': ({ userId: uid, username, role, votes }) => {
        // Reveal final vote tally for the summary popup
        const tally = {};
        if (Array.isArray(votes)) {
          votes.forEach(v => { tally[v.username] = parseInt(v.vote_count); });
        }
        setRevealedVotes({ tally, eliminated: username, role });
        // If an imposter was caught, show big reveal flashcard
        if (role === 'imposter') {
          setImposterReveal({ username, tally });
        }
        setShowVotePopup(true);

        setLobby(l => l ? {
          ...l,
          players: (l.players || []).map(p =>
            p.id === uid ? { ...p, is_eliminated: true, role } : p)  // no assigned_word stored
        } : l);
        setVoting(false);
        setShowVoteCard(false);
        setVoteResults({});
        setFinalGuessPlayer(null);
        addSystemMsg(`💀 ${username} was eliminated! (${role === 'imposter' ? '🔴 Imposter' : '🔵 Innocent'})`);

        // Post vote tally to chat
        const lines = Object.entries(tally)
          .sort(([,a],[,b]) => b - a)
          .map(([name, count]) => `  ${name}: ${count} vote${count !== 1 ? 's' : ''}`)
          .join('\n');
        addSystemMsg(`🗳️ Vote results:\n${lines}`);

        // Host restarts turns after elimination — but not if entering final-guess phase
        if (isHost) setTimeout(() => {
          const socket = getSocket();
          if (finalGuessPendingRef.current) return;
          const firstActive = (lobby?.players || []).filter(p => !p.is_eliminated && p.id !== uid);
          if (firstActive[0] && socket) {
            socket.emit('game:nextTurn', { code, currentTurnUserId: '__start__' });
          }
        }, 3500); // extra delay so popup can be seen
      },
      'game:paused': ({ pausedBy, reason }) => {
        setPaused(true);
        setPauseInfo({ pausedBy, reason });
        stopTurnTimer();
        setShowHintCard(false);
        addSystemMsg(`⏸️ Game paused by ${pausedBy}${reason ? `: ${reason}` : ''}`);
      },
      'game:resumed': ({ resumedBy }) => {
        setPaused(false);
        setPauseInfo(null);
        // Refresh full lobby state on resume — roles/words may need restoring
        fetchLobby();
        // If we had a turn running, restart its timer
        if (currentTurnUserId && turnTimeLeftRef.current > 0) {
          startTurnTimer(turnTimeLeftRef.current);
        }
        addSystemMsg(`▶️ Game resumed by ${resumedBy}`);
      },
      'game:playerDisconnected': ({ username, message }) => {
        setDisconnectedUsers(d => [...d, username]);
        addSystemMsg(`📡 ${message}`);
      },
      'game:playerReconnected': ({ userId: uid, username }) => {
        setDisconnectedUsers(d => d.filter(u => u !== username));
        addSystemMsg(`✅ ${username} reconnected`);
        // If this is us reconnecting, refresh lobby state
        if (uid === user.id) fetchLobby();
      },
      'game:wrongGuess': ({ guessedWord, message }) => {
        addSystemMsg(`❌ ${message}`);
      },
      'game:finalGuessRequired': ({ imposterId, imposterName, message }) => {
        // Stop everything — turn phase is over, final guess takes over
        finalGuessPendingRef.current = true;
        setVoting(false);
        stopTurnTimer();
        setCurrentTurnUserId(null);
        setCurrentTurnUsername(null);
        setShowHintCard(false);
        setShowVoteCard(false);
        setFinalGuessPlayer({ imposterId, imposterName });
        addSystemMsg(message);
      },
      'game:youMustGuess': () => {
        setMustGuess(true);
        // Don't auto-open the modal — let the imposter click the button themselves
        toast('⚔️ You must guess the innocent word! Tap the button on your card.', { duration: 6000 });
      },
      'lobby:reset': ({ message }) => {
        // Lobby is back to waiting — clear all game state locally
        setMyRole(null); setMyWord(null);
        setVoting(false); setMyVote(null); setVoteResults({});
        setCurrentTurnUserId(null); setCurrentTurnUsername(null);
        setTurnTimeLeft(0); setTurnRound(1);
        setPlayerHints({});
        setShowHintCard(false); setShowVoteCard(false); setShowVotePopup(false);
        setRevealedVotes(null); setImposterReveal(null);
        setFinalGuessPlayer(null); setMustGuess(false);
        finalGuessPendingRef.current = false;
        setPaused(false); setPauseInfo(null);
        setImposterCount(0);
        fetchLobby(); // refresh lobby status to 'waiting'
        addSystemMsg('🔄 Game over — lobby is ready for another round!');
      },

      'lobby:discarded': ({ message }) => {
        toast.error(message || 'This lobby was discarded by the host.');
        navigate('/games');
      },

      'game:ended': (result) => {
        setGameResult(result);
        setMyRole(null); setMyWord(null);
        setVoting(false);
        stopTurnTimer(); setCurrentTurnUserId(null);
        setShowHintCard(false);
        setMustGuess(false); setFinalGuessPlayer(null);
        finalGuessPendingRef.current = false;
        setShowVoteCard(false); setVoteCardPlayers([]); setShowVotePopup(false); setRevealedVotes(null); setImposterReveal(null);
        // Keep playerHints so result screen shows them
        // lobby:reset event fires 3s later and clears everything
        addSystemMsg(`🏆 Game Over! ${result.winner === 'innocents' ? '🔵 Innocents win!' : '🔴 Imposters win!'}`);
      },
    };

    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    return () => {
      Object.keys(handlers).forEach(ev => socket.off(ev, handlers[ev]));
      // Do NOT emit lobby:leave — player stays in the lobby, just navigating away
    };
  }, [code, user.id, getSocket, isHost, startTurnTimer, stopTurnTimer, currentTurnUserId, lobby?.turn_time]);

  // ── Submit hint from flashcard ────────────────────────────────────────────
  const submitHint = (e) => {
    e?.preventDefault();
    const trimmed = hintInput.trim();
    if (!trimmed) return;
    const word = trimmed.split(/\s+/)[0];

    // Block if hint IS the actual word (case-insensitive)
    if (myWord && word.toLowerCase() === myWord.toLowerCase()) {
      toast.error('You cannot give your own word as a hint!');
      return;
    }

    const socket = getSocket();
    // 1. Broadcast hint to all players (shown in player list)
    socket?.emit('game:submitHint', { code, hint: word });
    // 2. Also post as a chat message so the chatroom shows it
    socket?.emit('lobby:message', { code, content: `💬 Hint: "${word}"` });

    // game:hintSubmitted comes back from server for everyone — no local update needed
    setShowHintCard(false);

    // Advance turn
    socket?.emit('game:turnDone', { code });
    stopTurnTimer();
  };

  // ── Chat actions ──────────────────────────────────────────────────────────
  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    getSocket()?.emit('lobby:message', { code, content: text.trim(), replyToId: replyTo?.id });
    setText('');
    setReplyTo(null);
    clearTyping();
  };

  const handleTyping = (e) => {
    setText(e.target.value);
    getSocket()?.emit('lobby:typing', { code, isTyping: true });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(clearTyping, 1500);
  };

  const clearTyping = () => getSocket()?.emit('lobby:typing', { code, isTyping: false });

  // ── Game actions ──────────────────────────────────────────────────────────
  const startGame = async () => {
    try {
      await api.post(`/game/${code}/start`);
      setTimeout(() => {
        getSocket()?.emit('game:nextTurn', { code, currentTurnUserId: '__start__' });
      }, 1500);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to start'); }
  };

  const skipTurn = () => {
    if (!isHost || !currentTurnUserId) return;
    getSocket()?.emit('game:nextTurn', { code, currentTurnUserId });
  };

  const startVoting = async () => {
    try { await api.post(`/game/${code}/voting/start`); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const castVote = async (targetId) => {
    if (myVote || me?.is_eliminated) return;
    try {
      await api.post(`/game/${code}/vote`, { votedForId: targetId });
      setMyVote(targetId);
      setShowVoteCard(false);
      toast.success('Vote cast!');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to vote'); }
  };

  const pauseGame  = async () => { try { await api.post(`/game/${code}/pause`); } catch {} };
  const resumeGame = async () => { try { await api.post(`/game/${code}/resume`); } catch {} };

  const guessWord = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post(`/game/${code}/guess-word`, { guessedWord: wordGuess });
      toast[data.correct ? 'success' : 'error'](data.correct ? 'Correct! Imposters win!' : 'Wrong guess! You are eliminated.');
      setShowWordGuess(false); setWordGuess('');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const startLiveAudio = () => {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const socket = getSocket();
      socket?.emit('lobby:audioStreamStart', { code });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => socket?.emit('lobby:audioStream', { code, audioChunk: e.data });
      mr.start(100);
      setRecording(true);
    }).catch(() => toast.error('Microphone access denied'));
  };

  const stopLiveAudio = () => {
    mediaRecorderRef.current?.stop();
    getSocket()?.emit('lobby:audioStreamEnd', { code });
    setRecording(false);
  };

  const sendAudioMessage = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        getSocket()?.emit('lobby:message', { code, content: '🎙️ Audio message', messageType: 'audio', audioUrl: URL.createObjectURL(blob) });
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      setTimeout(() => mr.stop(), 10000);
      toast('Recording... max 10s', { icon: '🎙️' });
    } catch { toast.error('Mic access denied'); }
  };

  const addReaction = (messageId, emoji) => {
    getSocket()?.emit('lobby:reaction', { code, messageId, emoji });
    setShowReactionPicker(null);
  };

  const saveSettings = async () => {
    try { await api.patch(`/lobby/${code}/settings`, settings); toast.success('Settings saved!'); setShowSettings(false); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const copyCode = () => {
    const url = `${window.location.origin}/games/lobby/${code}`;
    const fallback = () => {
      try {
        const el = document.createElement('textarea');
        el.value = url;
        el.style.position = 'fixed'; el.style.opacity = '0';
        document.body.appendChild(el); el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        toast.success('Lobby link copied!');
      } catch { toast.error('Could not copy — code: ' + code); }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => toast.success('Lobby link copied!')).catch(fallback);
    } else { fallback(); }
  };
  // Back arrow — just navigates away, player stays in lobby
  const goBack = () => navigate('/games');

  // Explicit leave — removes player from lobby permanently
  const leaveLobby = async () => {
    try {
      await api.post(`/lobby/${code}/leave`);
      navigate('/games');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cannot leave right now');
    }
    setShowLeaveConfirm(false);
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const turnPct     = lobby ? (turnTimeLeft / lobby.turn_time) * 100 : 0;
  const timerColour = turnPct > 50 ? 'var(--green-b)' : turnPct > 25 ? 'var(--yellow-b, #fabd2f)' : 'var(--red-b)';

  if (loading) return (
    <div className="h-full flex items-center justify-center" style={{ color: 'var(--fg3)' }}>
      <div className="text-center">
        <div className="font-display text-4xl mb-2" style={{ color: 'var(--yellow)' }}>🕵️</div>
        <p>Loading lobby...</p>
      </div>
    </div>
  );

  if (!lobby) return null;

  return (
    <div className="h-full flex flex-col" style={{ color: 'var(--fg)' }}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0 flex-wrap"
        style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--bg3)' }}>
        <div className="relative">
          <button onClick={goBack} className="btn-ghost p-2 rounded" title="Back to dashboard">
            <ArrowLeft size={16} />
          </button>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-base md:text-xl tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>{code}</span>
            <button onClick={copyCode} className="p-1 rounded" style={{ color: 'var(--fg3)' }}><Copy size={13} /></button>
          </div>
          <div className="text-xs" style={{ color: 'var(--fg3)' }}>
            {lobby.name} · {activePlayers.length}/{lobby.max_players} players
          </div>
        </div>

        <div className="flex-1" />
        <StatusBadge status={isPaused ? 'paused' : lobby.status} />

        {isHost && (
          <div className="flex gap-1">
            {isWaiting && (
              <button onClick={startGame} className="btn-primary px-2 md:px-3 py-1.5 rounded text-xs flex items-center gap-1">
                <Play size={13} /> Start
              </button>
            )}
            {isPlaying && !voting && !isPaused && currentTurnUserId && (
              <button onClick={skipTurn} className="btn-ghost px-3 py-1.5 rounded text-xs flex items-center gap-1">
                <SkipForward size={13} /> Skip
              </button>
            )}
            {/* Voting is now automatic — no manual vote button needed */}
            <button onClick={() => setShowSettings(v => !v)} className="btn-ghost p-2 rounded">
              <Settings size={15} />
            </button>
          </div>
        )}

        {isPlaying && !isPaused && (
          <button onClick={pauseGame} className="btn-ghost px-3 py-1.5 rounded text-xs flex items-center gap-1">
            <Pause size={13} /> Pause
          </button>
        )}

        {/* Leave lobby — explicit action, separate from back button */}
        <button
          onClick={() => setShowLeaveConfirm(true)}
          className="btn-ghost px-2 py-1.5 rounded text-xs"
          style={{ color: 'var(--red-b)', opacity: 0.7 }}
          title="Leave this lobby permanently"
        >
          Leave
        </button>
        {isPaused && (
          <button onClick={resumeGame} className="btn-primary px-3 py-1.5 rounded text-xs flex items-center gap-1">
            <Play size={13} /> Resume
          </button>
        )}
      </div>

      {/* ── Turn progress bar ────────────────────────────────────────────── */}
      {isPlaying && !isPaused && currentTurnUserId && !voting && (
        <div className="shrink-0 px-4 py-2 flex items-center gap-3"
          style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--bg3)' }}>
          <Timer size={14} style={{ color: timerColour, flexShrink: 0 }} />
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs">
                {isMyTurn
                  ? <span className="font-bold" style={{ color: 'var(--yellow-b, #fabd2f)' }}>🎤 Your turn!</span>
                  : <span style={{ color: 'var(--fg2)' }}>
                      <strong style={{ color: 'var(--aqua-b)' }}>{currentTurnUsername}</strong> is giving a hint...
                    </span>
                }
              </span>
              <span className="font-display text-sm tabular-nums ml-3" style={{ color: timerColour }}>
                {turnTimeLeft}s
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg3)' }}>
              <div className="h-full rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${turnPct}%`, background: timerColour }} />
            </div>
          </div>
          <span className="text-xs shrink-0" style={{ color: 'var(--fg3)' }}>Rnd {turnRound}</span>
        </div>
      )}

      {/* ── Pause notice ─────────────────────────────────────────────────── */}
      {isPaused && pauseInfo && (
        <div className="px-4 py-2 flex items-center gap-2 text-xs shrink-0"
          style={{ background: 'rgba(215,153,33,0.15)', borderBottom: '1px solid var(--yellow)', color: 'var(--yellow-b, #fabd2f)' }}>
          <Pause size={13} />
          <span>Paused by <strong>{pauseInfo.pausedBy}</strong>{pauseInfo.reason ? ` — ${pauseInfo.reason}` : ''}. Any player can resume.</span>
        </div>
      )}

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      {showSettings && isHost && (
        <div className="px-4 py-3 shrink-0 animate-fade-in"
          style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--bg3)' }}>
          <div className="flex gap-4 items-end flex-wrap">
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--fg3)' }}>Turn Time (sec)</label>
              <input type="number" min={10} max={120} value={settings.turnTime}
                onChange={e => setSettings(s => ({ ...s, turnTime: +e.target.value }))}
                className="grv-input w-24 py-1.5 px-2 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: 'var(--fg3)' }}>Max Players</label>
              <input type="number" min={3} max={20} value={settings.maxPlayers}
                onChange={e => setSettings(s => ({ ...s, maxPlayers: +e.target.value }))}
                className="grv-input w-20 py-1.5 px-2 rounded text-sm" />
            </div>
            <button onClick={saveSettings} className="btn-primary px-3 py-1.5 rounded text-xs">Save</button>
            <button onClick={() => setShowSettings(false)} className="btn-ghost px-3 py-1.5 rounded text-xs">Cancel</button>
          </div>
        </div>
      )}

      {/* ── Mobile tab switcher (hidden on md+) ─────────────────────────── */}
      {isMobile && (
        <div className="md:hidden flex shrink-0" style={{ background: 'var(--bg2)', borderBottom: '1px solid var(--bg3)' }}>
          <button
            onClick={() => setMobileTab('players')}
            className="flex-1 py-2.5 text-xs font-bold transition-colors"
            style={{ color: mobileTab === 'players' ? 'var(--yellow-b, #fabd2f)' : 'var(--fg3)',
                     borderBottom: mobileTab === 'players' ? '2px solid var(--yellow)' : '2px solid transparent' }}>
            👥 Players
          </button>
          <button
            onClick={() => setMobileTab('chat')}
            className="flex-1 py-2.5 text-xs font-bold transition-colors"
            style={{ color: mobileTab === 'chat' ? 'var(--yellow-b, #fabd2f)' : 'var(--fg3)',
                     borderBottom: mobileTab === 'chat' ? '2px solid var(--yellow)' : '2px solid transparent' }}>
            💬 Chat
          </button>
        </div>
      )}

      {/* ── Main body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Players panel ──────────────────────────────────────────────── */}
        <div
          className="flex-col shrink-0"
          style={{
            background: 'var(--bg1)', borderRight: '1px solid var(--bg3)',
            width: isMobile ? '100%' : 280,
            display: isMobile ? (mobileTab === 'players' ? 'flex' : 'none') : 'flex',
          }}>

          {/* My word card */}
          {myWord && (
            <div className="m-3 p-3 rounded-lg text-center"
              style={{ background: 'var(--bg)', border: `2px solid ${myRole === 'imposter' ? 'var(--red)' : 'var(--blue)'}` }}>
              <div className="text-xs font-bold mb-1"
                style={{ color: myRole === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                {myRole === 'imposter' ? '🔴 IMPOSTER' : '🔵 INNOCENT'}
              </div>
              <div className="font-display text-2xl uppercase tracking-widest"
                style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                {myWord}
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>Your secret word</div>
              {myRole === 'imposter' && isPlaying && mustGuess && (
                <button
                  onClick={() => setShowWordGuess(true)}
                  className="mt-2 w-full py-2 rounded text-xs font-bold"
                  style={{
                    background: 'var(--red)',
                    color: 'var(--fg)',
                    border: '2px solid var(--red-b)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}>
                  ⚔️ Tap to Guess the Word
                </button>
              )}
            </div>
          )}

          {!myWord && isPlaying && (
            <div className="p-3 text-center" style={{ color: 'var(--fg3)' }}>
              <Eye size={18} className="mx-auto mb-1 opacity-50" />
              <p className="text-xs">Spectating</p>
            </div>
          )}

          {/* Player list header */}
          <div className="px-3 py-2 flex items-center justify-between shrink-0">
            <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--fg3)' }}>
              PLAYERS ({lobby.players?.length || 0})
            </span>
            {imposterCount > 0 && isPlaying && (
              <span className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'rgba(204,36,29,0.15)', color: 'var(--red-b)', border: '1px solid var(--red)' }}>
                {imposterCount} 🔴
              </span>
            )}
          </div>

          {/* Player list */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {(lobby.players || []).map(p => {
              const isElim        = p.is_eliminated;
              const isMe          = p.id === user.id;
              const isLobbyHost   = p.id === lobby.host_id;
              const isCurrentTurn = p.id === currentTurnUserId;
              const hint          = playerHints[p.id];
              const voteCount     = voteResults[p.id] || 0;
              const isDisconnected = disconnectedUsers.includes(p.username);

              return (
                <div key={p.id}
                  onClick={() => voting && !myVote && !isElim && !isMe && !me?.is_eliminated && castVote(p.id)}
                  className={clsx(
                    'rounded-lg transition-all p-2',
                    isElim ? 'opacity-40' : '',
                    voting && !myVote && !isElim && !isMe && !me?.is_eliminated
                      ? 'cursor-pointer hover:ring-1 ring-purple-400' : '',
                    myVote === p.id ? 'ring-1 ring-purple-400' : '',
                  )}
                  style={{
                    background: isCurrentTurn && !isElim ? 'var(--bg2)' : isElim ? 'transparent' : 'var(--bg)',
                    outline: isCurrentTurn && !isElim ? `2px solid ${timerColour}` : undefined,
                  }}
                >
                  {/* Row 1: avatar + name + badges */}
                  <div className="flex items-center gap-2">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded flex items-center justify-center font-bold text-xs"
                        style={{ background: isElim ? 'var(--bg3)' : (p.avatar_color || '#458588'), color: '#282828' }}>
                        {p.username?.[0]?.toUpperCase()}
                      </div>
                      {isLobbyHost && !isElim && (
                        <Crown size={9} className="absolute -top-1 -right-1" style={{ color: 'var(--yellow)' }} />
                      )}
                      {isCurrentTurn && !isElim && (
                        <span className="absolute -bottom-1 -left-1 text-xs leading-none">🎤</span>
                      )}
                      {/* Online / offline dot — bottom right */}
                      {!isCurrentTurn && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                          style={{
                            borderColor: 'var(--bg1)',
                            background: (onlineUsers[p.id] || p.status) === 'online' ? 'var(--green-b)'
                                      : (onlineUsers[p.id] || p.status) === 'busy'   ? 'var(--red-b)'
                                      : 'var(--bg3)',
                          }}
                          title={(onlineUsers[p.id] || p.status) === 'online' ? 'Online'
                               : (onlineUsers[p.id] || p.status) === 'busy'   ? 'In game'
                               : 'Offline'}
                        />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-xs font-bold truncate', isElim && 'line-through')}>
                        {p.username}{isMe && <span style={{ color: 'var(--fg3)' }}> (you)</span>}
                      </div>
                      {isElim && p.role && (
                        <div className="text-xs" style={{ color: p.role === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                          {p.role === 'imposter' ? '🔴 Imposter' : '🔵 Innocent'}
                        </div>
                      )}
                    </div>

                    {/* Never show vote counts during active voting — anonymous until reveal */}
                  </div>

                  {/* All hints — simple pills, no round labels */}
                  {hint && hint.length > 0 && !isElim && (
                    <div className="mt-1.5 ml-10 flex flex-wrap gap-1">
                      {hint.map((h, i) => (
                        <span key={i} style={{
                          fontSize: 11, fontWeight: 700,
                          padding: '2px 7px', borderRadius: 10,
                          background: 'rgba(104,157,106,0.15)',
                          border: '1px solid var(--aqua)',
                          color: 'var(--aqua-b)',
                          wordBreak: 'break-word',
                        }}>
                          {h}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live audio indicator */}
          {liveAudioUsers.length > 0 && (
            <div className="p-2 border-t shrink-0" style={{ borderColor: 'var(--bg3)' }}>
              <div className="text-xs" style={{ color: 'var(--green-b)' }}>
                🎙️ {liveAudioUsers.map(u => u.username).join(', ')} speaking
              </div>
            </div>
          )}
        </div>

        {/* ── Chat panel ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: isMobile ? (mobileTab === 'chat' ? 'flex' : 'none') : 'flex',
            flex: 1, flexDirection: 'column', overflow: 'hidden',
          }}>

          {/* Game result */}
          {gameResult && (
            <div className="shrink-0 animate-fade-in"
              style={{
                background: gameResult.winner === 'innocents' ? 'rgba(69,133,136,0.2)' : 'rgba(204,36,29,0.2)',
                borderBottom: '2px solid ' + (gameResult.winner === 'innocents' ? 'var(--blue)' : 'var(--red)'),
                padding: '12px 16px',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="font-display" style={{ fontSize: 22, color: 'var(--yellow-b, #fabd2f)' }}>
                    {gameResult.winner === 'innocents' ? '🔵 INNOCENTS WIN!' : '🔴 IMPOSTERS WIN!'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 2 }}>
                    Innocent word: <strong style={{ color: 'var(--blue-b)' }}>{gameResult.innocentWord}</strong>
                    &nbsp;·&nbsp;
                    Imposter word: <strong style={{ color: 'var(--red-b)' }}>{gameResult.imposterWord}</strong>
                  </div>
                </div>
                {isHost && (
                  <button
                    onClick={startGame}
                    className="btn-primary"
                    style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    ▶ Play Again
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Final guess banner — shown to everyone when imposter must guess */}
          {finalGuessPlayer && !gameResult && (
            <div className="px-4 py-3 shrink-0 text-center"
              style={{ background: 'rgba(204,36,29,0.2)', borderBottom: '2px solid var(--red)' }}>
              <div className="text-sm font-bold" style={{ color: 'var(--red-b)' }}>
                ⚔️ {finalGuessPlayer.imposterName} must guess the innocent word!
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--fg3)' }}>
                {finalGuessPlayer.imposterId === user.id
                  ? 'Use the "Guess Innocent Word" button in your word card →'
                  : 'Waiting for them to guess...'}
              </div>
            </div>
          )}

          {/* Voting: small status bar after flashcard dismissed */}
          {voting && (
            <div className="px-4 py-2 shrink-0 flex items-center justify-between text-xs"
              style={{ background: 'rgba(177,98,134,0.15)', borderBottom: '1px solid var(--purple)' }}>
              <span style={{ color: 'var(--purple-b)' }}>🗳️ Voting in progress</span>
              <div className="flex items-center gap-2">
                {!myVote && !me?.is_eliminated && (
                  <button onClick={() => setShowVoteCard(true)}
                    className="text-xs px-2 py-0.5 rounded font-bold"
                    style={{ background: 'var(--purple)', color: 'var(--fg)' }}>
                    Open Vote Card
                  </button>
                )}
                {myVote && <span style={{ color: 'var(--green-b)' }}>✓ Vote cast</span>}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {messages.map((msg, i) => {
              if (msg.message_type === 'system') {
                return (
                  <div key={msg.id || i} className="text-center text-xs py-1 px-3 rounded mx-auto"
                    style={{ color: 'var(--fg3)', background: 'var(--bg2)', maxWidth: '92%' }}>
                    {msg.content}
                  </div>
                );
              }
              const isMe = msg.sender_id === user.id;
              return (
                <div key={msg.id || i} className={clsx('flex gap-2 group', { 'flex-row-reverse': isMe })}>
                  {!isMe && (
                    <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold shrink-0 mt-1"
                      style={{ background: msg.sender_avatar || '#458588', color: '#282828' }}>
                      {msg.sender_username?.[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="max-w-xs">
                    {!isMe && <div className="text-xs mb-0.5 pl-1" style={{ color: 'var(--fg3)' }}>{msg.sender_username}</div>}
                    {msg.reply_to_id && (
                      <div className="text-xs mb-1 px-2 py-1 rounded border-l-2 opacity-70"
                        style={{ borderColor: 'var(--blue)', background: 'var(--bg2)', color: 'var(--fg3)' }}>
                        ↩ {msg.reply_content?.substring(0, 40) || '...'}
                      </div>
                    )}
                    <div className="px-3 py-2 rounded-lg text-sm"
                      style={{ background: isMe ? 'var(--blue)' : 'var(--bg2)', color: 'var(--fg)' }}>
                      {msg.message_type === 'audio'
                        ? <audio controls src={msg.audio_url} style={{ height: 30 }} />
                        : <span style={{ wordBreak: 'break-word' }}>{msg.content}</span>}
                      {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {Object.entries(msg.reactions).map(([emoji, users]) => (
                            <span key={emoji} className="text-xs px-1 rounded cursor-pointer"
                              style={{ background: 'var(--bg3)' }}
                              onClick={() => addReaction(msg.id, emoji)}>
                              {emoji} {Array.isArray(users) ? users.length : 0}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2"
                      style={{ color: 'var(--fg3)', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                      <button onClick={() => setReplyTo(msg)}>↩ reply</button>
                      <button onClick={() => setShowReactionPicker(showReactionPicker === msg.id ? null : msg.id)}>
                        <Smile size={11} />
                      </button>
                    </div>
                    {showReactionPicker === msg.id && (
                      <div className="flex gap-1 mt-1 p-2 rounded"
                        style={{ background: 'var(--bg2)', border: '1px solid var(--bg3)' }}>
                        {REACTIONS.map(e => (
                          <button key={e} onClick={() => addReaction(msg.id, e)}
                            className="text-base hover:scale-125 transition-transform">{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {typingUsers.length > 0 && (
              <div className="text-xs italic pl-2" style={{ color: 'var(--fg3)' }}>
                {typingUsers.map(u => u.username).join(', ')} typing...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {replyTo && (
            <div className="mx-3 mb-1 px-2 py-1 rounded flex items-center justify-between text-xs"
              style={{ background: 'var(--bg2)', border: '1px solid var(--blue)', color: 'var(--fg3)' }}>
              <span>↩ {replyTo.sender_username}: {replyTo.content?.substring(0, 40)}</span>
              <button onClick={() => setReplyTo(null)} style={{ color: 'var(--red-b)' }}><X size={11} /></button>
            </div>
          )}

          <form onSubmit={sendMessage} className="flex gap-2 p-3 shrink-0"
            style={{ borderTop: '1px solid var(--bg3)' }}>
            <input value={text} onChange={handleTyping} placeholder="Message the lobby..."
              className="grv-input flex-1 py-2 px-3 rounded text-sm"
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(e)} />
            <button type="button" onClick={sendAudioMessage} className="btn-ghost p-2 rounded" title="Send audio message">
              <Mic size={15} />
            </button>
            <button type="button" onMouseDown={startLiveAudio} onMouseUp={stopLiveAudio}
              className={clsx('p-2 rounded', recording ? 'btn-danger' : 'btn-ghost')} title="Hold for live audio">
              {recording ? <MicOff size={15} /> : <Volume2 size={15} />}
            </button>
            <button type="submit" className="btn-primary px-3 py-2 rounded flex items-center gap-1 text-sm">
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>



      {/* ══════════════════════════════════════════════════════════════════
          IMPOSTER REVEAL FLASHCARD — shown to everyone when imposter caught
      ══════════════════════════════════════════════════════════════════ */}
      {imposterReveal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 65,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', padding: 16,
        }}
          onClick={() => setImposterReveal(null)}
        >
          <div className="animate-slide-up" style={{
            width: '100%', maxWidth: 380, borderRadius: 20, overflow: 'hidden',
            border: '3px solid #cc241d',
            boxShadow: '0 0 60px rgba(204,36,29,0.6)',
          }}
            onClick={e => e.stopPropagation()}
          >
            {/* Big red header */}
            <div style={{ background: '#cc241d', padding: '28px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🔴</div>
              <div style={{ fontFamily: 'VT323, monospace', fontSize: 52, color: '#ffffff', letterSpacing: 4, lineHeight: 1 }}>
                IMPOSTER!
              </div>
              <div style={{ fontFamily: 'VT323, monospace', fontSize: 32, color: '#fbf1c7', marginTop: 8 }}>
                {imposterReveal.username}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(251,241,199,0.7)', marginTop: 4 }}>
                was the imposter!
              </div>
            </div>

            {/* Who voted them */}
            <div style={{ background: '#1d2021', padding: '16px 20px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: '#928374', marginBottom: 12, textTransform: 'uppercase' }}>
                Vote breakdown
              </div>
              {Object.entries(imposterReveal.tally || {})
                .sort(([,a],[,b]) => b - a)
                .map(([name, votes]) => {
                  const maxV = Math.max(...Object.values(imposterReveal.tally));
                  return (
                    <div key={name} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, color: '#ebdbb2' }}>{name}</span>
                        <span style={{ fontSize: 13, color: '#a89984' }}>{votes} vote{votes !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 3, background: '#3c3836' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${(votes/maxV)*100}%`, background: '#cc241d', transition: 'width 0.5s' }} />
                      </div>
                    </div>
                  );
                })}
            </div>

            <div style={{ background: '#1d2021', padding: '12px 20px', textAlign: 'center', borderTop: '1px solid #3c3836' }}>
              <button onClick={() => setImposterReveal(null)} style={{
                padding: '10px 40px', borderRadius: 8, fontWeight: 700, fontSize: 14,
                background: '#cc241d', color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: '"JetBrains Mono", monospace',
              }}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          VOTE RESULTS POPUP — shown after each voting round ends
      ══════════════════════════════════════════════════════════════════ */}
      {showVotePopup && revealedVotes && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 60,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          padding: 16,
        }}>
          <div className="animate-slide-up" style={{
            width: '100%', maxWidth: 360, borderRadius: 16, overflow: 'hidden',
            border: revealedVotes.tied ? '2px solid var(--yellow)' : '2px solid var(--purple)',
            boxShadow: '0 0 40px rgba(177,98,134,0.3)',
          }}>
            {/* Header */}
            <div style={{ background: 'var(--bg1)', padding: '16px 20px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'VT323, monospace', fontSize: 32,
                color: revealedVotes.tied ? 'var(--yellow-b, #fabd2f)' : 'var(--purple-b)' }}>
                {revealedVotes.tied ? '⚖️ TIE!' : '🗳️ VOTE RESULTS'}
              </div>
              {revealedVotes.tied && (
                <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>
                  {revealedVotes.tiedNames} are tied — vote again!
                </div>
              )}
              {!revealedVotes.tied && revealedVotes.eliminated && (
                <div style={{ fontSize: 12, color: 'var(--fg3)', marginTop: 4 }}>
                  <strong style={{ color: 'var(--red-b)' }}>{revealedVotes.eliminated}</strong> was eliminated
                </div>
              )}
            </div>

            {/* Tally */}
            <div style={{ background: 'var(--bg2)', padding: '12px 16px', borderTop: '1px solid var(--bg3)' }}>
              {Object.entries(revealedVotes.tally || {})
                .sort(([,a],[,b]) => b - a)
                .map(([name, votes]) => {
                  const isEliminated = name === revealedVotes.eliminated;
                  const maxVotes = Math.max(...Object.values(revealedVotes.tally));
                  const pct = maxVotes > 0 ? (votes / maxVotes) * 100 : 0;
                  return (
                    <div key={name} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{
                          fontSize: 13, fontWeight: 700,
                          color: isEliminated ? 'var(--red-b)' : 'var(--fg)',
                        }}>
                          {isEliminated ? '💀 ' : ''}{name}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg2)' }}>
                          {votes} vote{votes !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg3)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${pct}%`,
                          background: isEliminated ? 'var(--red)' : 'var(--purple)',
                          transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  );
                })}
            </div>

            {/* Close */}
            <div style={{ background: 'var(--bg1)', padding: '12px 16px', textAlign: 'center' }}>
              <button
                onClick={() => setShowVotePopup(false)}
                className="btn-ghost"
                style={{ padding: '8px 32px', borderRadius: 8, fontSize: 13, fontWeight: 700 }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          HINT FLASHCARD — only visible to the current turn player
          Floats over everything, separate from chat
      ══════════════════════════════════════════════════════════════════ */}
      {showHintCard && isMyTurn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
          <div className="animate-slide-up w-full max-w-md mx-2 md:mx-4 rounded-2xl overflow-hidden"
            style={{ border: '2px solid var(--yellow)', boxShadow: '0 0 60px rgba(215,153,33,0.35)' }}>

            {/* Card header */}
            <div className="px-6 pt-6 pb-4 text-center"
              style={{ background: 'var(--bg1)' }}>
              <div className="font-display text-4xl mb-1" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                🎤
              </div>
              <h2 className="font-display text-2xl md:text-3xl tracking-widest mb-1"
                style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                YOUR TURN
              </h2>
              <p className="text-xs" style={{ color: 'var(--fg3)' }}>
                Give ONE word as a hint about your secret word
              </p>
            </div>

            {/* Word reveal */}
            <div className="py-5 text-center"
              style={{ background: 'var(--bg2)', borderTop: '1px solid var(--bg3)', borderBottom: '1px solid var(--bg3)' }}>
              <div className="text-xs font-bold mb-2 tracking-widest uppercase"
                style={{ color: myRole === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                {myRole === 'imposter' ? '🔴 You are the IMPOSTER' : '🔵 You are INNOCENT'}
              </div>
              <div className="font-display text-4xl md:text-5xl uppercase tracking-widest"
                style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                {myWord}
              </div>
              <div className="text-xs mt-2" style={{ color: 'var(--fg3)' }}>
                Your secret word — don't reveal it directly!
              </div>
            </div>

            {/* Timer bar */}
            <div className="px-6 pt-4" style={{ background: 'var(--bg1)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: 'var(--fg3)' }}>Time remaining</span>
                <span className="font-display text-xl tabular-nums" style={{ color: timerColour }}>
                  {turnTimeLeft}s
                </span>
              </div>
              <div className="h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--bg3)' }}>
                <div className="h-full rounded-full transition-all duration-1000 ease-linear"
                  style={{ width: `${turnPct}%`, background: timerColour }} />
              </div>
            </div>

            {/* Hint input */}
            <form onSubmit={submitHint} className="px-6 pb-6"
              style={{ background: 'var(--bg1)' }}>
              <div className="flex gap-2">
                <input
                  ref={hintInputRef}
                  value={hintInput}
                  onChange={e => setHintInput(e.target.value.split(/\s+/)[0] || '')}
                  placeholder="One word hint..."
                  maxLength={30}
                  className="grv-input flex-1 py-3 px-4 rounded-lg text-base font-bold"
                  style={{ letterSpacing: '0.05em', borderColor: 'var(--yellow)' }}
                  autoComplete="off"
                  spellCheck="false"
                />
                <button type="submit"
                  disabled={!hintInput.trim()}
                  className="btn-primary px-5 py-3 rounded-lg font-bold text-sm disabled:opacity-40"
                  style={{ background: 'var(--yellow)', color: 'var(--bg)', border: 'none' }}>
                  Submit
                </button>
              </div>
              <p className="text-xs mt-2 text-center" style={{ color: 'var(--fg3)' }}>
                One word only · submitting ends your turn
              </p>
            </form>
          </div>
        </div>
      )}


      {/* ── Leave lobby confirmation ─────────────────────────────────────── */}
      {showLeaveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="grv-panel rounded-xl p-6 w-full max-w-sm animate-slide-up">
            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--red-b)' }}>Leave Lobby?</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--fg3)' }}>
              You'll be removed from <strong style={{ color: 'var(--fg)' }}>{lobby?.name}</strong>.
              {lobby?.status === 'playing'
                ? ' The game is in progress — pause it first before leaving.'
                : ' You can rejoin later with the lobby code.'}
            </p>
            <div className="flex gap-2">
              {lobby?.status !== 'playing' && (
                <button onClick={leaveLobby} className="btn-danger flex-1 py-2 rounded text-sm font-bold">
                  Leave
                </button>
              )}
              <button onClick={() => setShowLeaveConfirm(false)} className="btn-ghost flex-1 py-2 rounded text-sm">
                {lobby?.status === 'playing' ? 'OK' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          VOTE FLASHCARD — shown to each active player during voting
      ══════════════════════════════════════════════════════════════════ */}
      {showVoteCard && voting && !me?.is_eliminated && !myVote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.80)', backdropFilter: 'blur(4px)' }}>
          <div className="animate-slide-up w-full max-w-lg mx-4 rounded-2xl overflow-hidden"
            style={{ border: '2px solid var(--purple)', boxShadow: '0 0 60px rgba(177,98,134,0.35)' }}>

            {/* Header */}
            <div className="px-6 pt-6 pb-4 text-center"
              style={{ background: 'var(--bg1)' }}>
              <div className="font-display text-5xl mb-1">🗳️</div>
              <h2 className="font-display text-3xl tracking-widest mb-1"
                style={{ color: 'var(--purple-b)' }}>
                VOTE
              </h2>
              <p className="text-xs" style={{ color: 'var(--fg3)' }}>
                Pick who you think is the imposter — most votes gets eliminated
              </p>
            </div>

            {/* Player cards grid */}
            <div className="p-3 md:p-4 grid grid-cols-2 gap-2 md:gap-3"
              style={{ background: 'var(--bg2)', borderTop: '1px solid var(--bg3)', borderBottom: '1px solid var(--bg3)' }}>
              {(lobby?.players || [])
                .filter(p => !p.is_eliminated && p.id !== user.id)
                .map(p => {
                  const hint     = playerHints[p.id];
                  const votes    = voteResults[p.id] || 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => castVote(p.id)}
                      className="flex flex-col items-center gap-2 p-4 rounded-xl transition-all hover:scale-105 active:scale-95"
                      style={{
                        background: 'var(--bg)',
                        border: '2px solid var(--bg3)',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--purple)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--bg3)'}
                    >
                      {/* Avatar */}
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center font-bold text-xl md:text-2xl"
                        style={{ background: p.avatar_color || '#458588', color: '#282828' }}>
                        {p.username?.[0]?.toUpperCase()}
                      </div>
                      {/* Name */}
                      <div className="font-bold text-xs md:text-sm text-center truncate max-w-full" style={{ color: 'var(--fg)' }}>
                        {p.username}
                      </div>
                      {/* All hints — no round labels */}
                      {hint && hint.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center', width: '100%' }}>
                          {hint.map((h, i) => (
                            <span key={i} style={{
                              fontSize: 11, fontWeight: 700,
                              padding: '2px 8px', borderRadius: 10,
                              background: 'rgba(104,157,106,0.2)',
                              border: '1px solid var(--aqua)',
                              color: 'var(--aqua-b)',
                              wordBreak: 'break-word',
                            }}>
                              {h}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Vote count if any */}
                      {votes > 0 && (
                        <div className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{ background: 'var(--purple)', color: 'var(--fg)' }}>
                          {votes} vote{votes > 1 ? 's' : ''}
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 flex items-center justify-between"
              style={{ background: 'var(--bg1)' }}>
              <p className="text-xs" style={{ color: 'var(--fg3)' }}>
                Click a player card to cast your vote
              </p>
              <button
                onClick={() => setShowVoteCard(false)}
                className="btn-ghost px-3 py-1.5 rounded text-xs">
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Word guess modal ─────────────────────────────────────────────── */}
      {showWordGuess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="grv-panel rounded-xl p-6 w-full max-w-sm animate-slide-up">
            <h3 className="font-bold text-lg mb-2" style={{ color: 'var(--red-b)' }}>🔴 Guess the Innocent Word</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--fg3)' }}>
              Correct → imposters win. Wrong → you're eliminated.
            </p>
            <form onSubmit={guessWord}>
              <input value={wordGuess} onChange={e => setWordGuess(e.target.value)}
                placeholder="Type your guess..." autoFocus required
                className="grv-input w-full py-2.5 px-3 rounded mb-3 text-sm" />
              <div className="flex gap-2">
                <button type="submit" className="btn-danger flex-1 py-2 rounded text-sm font-bold">Submit</button>
                <button type="button" onClick={() => setShowWordGuess(false)} className="btn-ghost px-4 py-2 rounded text-sm">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    waiting:  { color: 'var(--green-b)',           label: '● Waiting'  },
    playing:  { color: 'var(--blue-b)',            label: '▶ Playing'  },
    paused:   { color: 'var(--yellow-b, #fabd2f)', label: '⏸ Paused'  },
    finished: { color: 'var(--fg3)',               label: '■ Finished' },
  }[status] || { color: 'var(--fg3)', label: status };

  return (
    <span className="text-xs font-bold px-2 py-1 rounded"
      style={{ color: cfg.color, background: 'var(--bg)' }}>
      {cfg.label}
    </span>
  );
}
