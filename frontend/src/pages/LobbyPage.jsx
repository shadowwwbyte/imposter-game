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
  const { getSocket } = useSocketStore();
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
  // playerHints: { [userId]: string }  — latest hint per player this round
  const [playerHints, setPlayerHints]   = useState({});
  const [hintInput, setHintInput]       = useState('');
  const [showHintCard, setShowHintCard] = useState(false); // flashcard modal
  const [mustGuess, setMustGuess]         = useState(false);  // imposter final guess prompt
  const [finalGuessPlayer, setFinalGuessPlayer] = useState(null); // { imposterId, imposterName }

  const messagesEndRef   = useRef(null);
  const mediaRecorderRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const turnTimerRef     = useRef(null);
  const turnTimeLeftRef  = useRef(0);
  const hintInputRef     = useRef(null);

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
    if (isMyTurn && isPlaying && !isPaused) {
      setHintInput('');
      setShowHintCard(true);
      setTimeout(() => hintInputRef.current?.focus(), 100);
    } else {
      setShowHintCard(false);
    }
  }, [isMyTurn, isPlaying, isPaused]);

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
      'lobby:playerJoined': ({ userId, username, avatar_color }) => {
        setLobby(l => l ? {
          ...l,
          players: [...(l.players || []).filter(p => p.id !== userId),
            { id: userId, username, avatar_color, is_eliminated: false }]
        } : l);
        addSystemMsg(`${username} joined the lobby`);
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
        setPlayerHints(h => ({ ...h, [uid]: hint }));
      },

      // ── Turn events ──
      'game:turnChanged': ({ currentTurnUserId: uid, currentTurnUsername: uname, turnTime, isNewRound, roundNumber }) => {
        setCurrentTurnUserId(uid);
        setCurrentTurnUsername(uname);
        setTurnRound(roundNumber);
        startTurnTimer(turnTime);
        // Clear hints at the start of each new round
        if (isNewRound) {
          setPlayerHints({});
          addSystemMsg(`🔄 Round ${roundNumber} begins!`);
        }
      },

      'game:turnDone': ({ userId: uid }) => {
        if (isHost) {
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
        addSystemMsg(`🎮 Game started! ${ic} imposter${ic > 1 ? 's' : ''} among ${totalPlayers} players. Each player will give a one-word hint on their turn.`);
      },
      'game:announcement': ({ message }) => addSystemMsg(message),

      'game:votingStarted': ({ message, auto }) => {
        setVoting(true);
        setMyVote(null);
        setVoteResults({});
        stopTurnTimer();
        setCurrentTurnUserId(null);
        setShowHintCard(false);
        addSystemMsg(message || '🗳️ Voting started! Click a player on the left to vote.');
        if (auto) toast('🗳️ Voting time!', { duration: 3000 });
      },
      'game:voteReceived': ({ totalVotes, totalPlayers, votedForId }) => {
        setVoteResults(v => ({ ...v, [votedForId]: (v[votedForId] || 0) + 1 }));
        addSystemMsg(`🗳️ Votes cast: ${totalVotes}/${totalPlayers}`);
      },
      'game:voteTie': ({ message }) => {
        setVoting(true); setMyVote(null); setVoteResults({});
        addSystemMsg(`⚖️ ${message}`);
      },
      'game:playerEliminated': ({ userId: uid, username, role, word }) => {
        setLobby(l => l ? {
          ...l,
          players: (l.players || []).map(p =>
            p.id === uid ? { ...p, is_eliminated: true, role, assigned_word: word } : p)
        } : l);
        setVoting(false);
        setFinalGuessPlayer(null);
        addSystemMsg(`💀 ${username} eliminated! They were ${role === 'imposter' ? '🔴 IMPOSTER' : '🔵 INNOCENT'} (word: "${word}")`);        // Host restarts turns after a short delay
        if (isHost) setTimeout(() => {
          const socket = getSocket();
          const firstActive = (lobby?.players || []).filter(p => !p.is_eliminated && p.id !== uid);
          if (firstActive[0] && socket) socket.emit('game:nextTurn', { code, currentTurnUserId: '__start__' });
        }, 2000);
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
        if (currentTurnUserId && turnTimeLeftRef.current > 0) startTurnTimer(turnTimeLeftRef.current);
        addSystemMsg(`▶️ Game resumed by ${resumedBy}`);
      },
      'game:playerDisconnected': ({ username, message }) => {
        setDisconnectedUsers(d => [...d, username]);
        addSystemMsg(`📡 ${message}`);
      },
      'game:playerReconnected': ({ username }) => {
        setDisconnectedUsers(d => d.filter(u => u !== username));
        addSystemMsg(`✅ ${username} reconnected`);
      },
      'game:wrongGuess': ({ guessedWord, message }) => {
        addSystemMsg(`❌ ${message} (guessed: "${guessedWord}")`);
      },
      'game:finalGuessRequired': ({ imposterId, imposterName, message }) => {
        setVoting(false);
        setFinalGuessPlayer({ imposterId, imposterName });
        addSystemMsg(message);
      },
      'game:youMustGuess': () => {
        setMustGuess(true);
        setShowWordGuess(true);
        toast('⚔️ Guess the innocent word now!', { duration: 5000, icon: '⚔️' });
      },
      'game:ended': (result) => {
        setGameResult(result);
        setMyRole(null); setMyWord(null);
        setVoting(false); setPlayerHints({});
        stopTurnTimer(); setCurrentTurnUserId(null);
        setShowHintCard(false);
        setMustGuess(false); setFinalGuessPlayer(null);
        fetchLobby();
        addSystemMsg(`🏆 Game Over! ${result.winner === 'innocents' ? '🔵 Innocents' : '🔴 Imposters'} win! — ${result.reason}`);
        addSystemMsg(`📖 Innocent word: "${result.innocentWord}" | Imposter word: "${result.imposterWord}"`);
      },
    };

    Object.entries(handlers).forEach(([ev, fn]) => socket.on(ev, fn));
    return () => {
      Object.keys(handlers).forEach(ev => socket.off(ev, handlers[ev]));
      socket.emit('lobby:leave', { code });
    };
  }, [code, user.id, getSocket, isHost, startTurnTimer, stopTurnTimer, currentTurnUserId, lobby?.turn_time]);

  // ── Submit hint from flashcard ────────────────────────────────────────────
  const submitHint = (e) => {
    e?.preventDefault();
    const trimmed = hintInput.trim();
    if (!trimmed) return;
    // Only single word
    const word = trimmed.split(/\s+/)[0];

    const socket = getSocket();
    // Broadcast to all players via a dedicated socket event (NOT lobby:message)
    socket?.emit('game:submitHint', { code, hint: word });

    // Update local state immediately
    setPlayerHints(h => ({ ...h, [user.id]: word }));
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

  const copyCode   = () => { navigator.clipboard.writeText(code); toast.success('Code copied!'); };
  const leaveLobby = async () => { try { await api.post(`/lobby/${code}/leave`); } catch {} navigate('/games'); };

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
      <div className="flex items-center gap-3 px-4 py-3 shrink-0"
        style={{ background: 'var(--bg1)', borderBottom: '1px solid var(--bg3)' }}>
        <button onClick={leaveLobby} className="btn-ghost p-2 rounded"><ArrowLeft size={16} /></button>

        <div>
          <div className="flex items-center gap-2">
            <span className="font-display text-xl tracking-widest" style={{ color: 'var(--yellow-b, #fabd2f)' }}>{code}</span>
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
              <button onClick={startGame} className="btn-primary px-3 py-1.5 rounded text-xs flex items-center gap-1">
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

      {/* ── Main body ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Players panel ──────────────────────────────────────────────── */}
        <div className="w-64 shrink-0 flex flex-col"
          style={{ background: 'var(--bg1)', borderRight: '1px solid var(--bg3)' }}>

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
              {myRole === 'imposter' && isPlaying && !isPaused && (
                <button onClick={() => setShowWordGuess(true)}
                  className="mt-2 btn-danger w-full py-1 rounded text-xs">
                  Guess Innocent Word
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
                      {isDisconnected && (
                        <WifiOff size={9} className="absolute -bottom-1 -right-1" style={{ color: 'var(--red-b)' }} />
                      )}
                      {isCurrentTurn && !isElim && (
                        <span className="absolute -bottom-1 -left-1 text-xs leading-none">🎤</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className={clsx('text-xs font-bold truncate', isElim && 'line-through')}>
                        {p.username}{isMe && <span style={{ color: 'var(--fg3)' }}> (you)</span>}
                      </div>
                      {isElim && p.role && (
                        <div className="text-xs" style={{ color: p.role === 'imposter' ? 'var(--red-b)' : 'var(--blue-b)' }}>
                          {p.role === 'imposter' ? '🔴' : '🔵'} {p.assigned_word}
                        </div>
                      )}
                    </div>

                    {voting && voteCount > 0 && (
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--purple)', color: 'var(--fg)' }}>
                        {voteCount}
                      </span>
                    )}
                  </div>

                  {/* Row 2: hint badge — shown below name, NOT in chat */}
                  {hint && !isElim && (
                    <div className="mt-1.5 ml-10 flex items-center gap-1">
                      <MessageSquare size={10} style={{ color: 'var(--aqua)', flexShrink: 0 }} />
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded-full truncate"
                        style={{
                          background: 'rgba(104,157,106,0.15)',
                          border: '1px solid var(--aqua)',
                          color: 'var(--aqua-b)',
                          maxWidth: 120,
                        }}
                        title={hint}
                      >
                        "{hint}"
                      </span>
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
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Game result */}
          {gameResult && (
            <div className="p-4 text-center shrink-0 animate-fade-in"
              style={{
                background: gameResult.winner === 'innocents' ? 'rgba(69,133,136,0.2)' : 'rgba(204,36,29,0.2)',
                borderBottom: '2px solid ' + (gameResult.winner === 'innocents' ? 'var(--blue)' : 'var(--red)')
              }}>
              <div className="font-display text-3xl mb-1" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                {gameResult.winner === 'innocents' ? '🔵 INNOCENTS WIN!' : '🔴 IMPOSTERS WIN!'}
              </div>
              <div className="text-xs" style={{ color: 'var(--fg3)' }}>
                Innocent: <strong style={{ color: 'var(--blue-b)' }}>{gameResult.innocentWord}</strong>
                &nbsp;·&nbsp;
                Imposter: <strong style={{ color: 'var(--red-b)' }}>{gameResult.imposterWord}</strong>
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

          {/* Voting banner */}
          {voting && !me?.is_eliminated && (
            <div className="px-4 py-2 shrink-0 text-center text-xs font-bold"
              style={{ background: 'rgba(177,98,134,0.2)', borderBottom: '1px solid var(--purple)', color: 'var(--purple-b)' }}>
              🗳️ VOTING — click a player on the left to eliminate
              {myVote && <span style={{ color: 'var(--green-b)' }}> ✓ Vote cast</span>}
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
          HINT FLASHCARD — only visible to the current turn player
          Floats over everything, separate from chat
      ══════════════════════════════════════════════════════════════════ */}
      {showHintCard && isMyTurn && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
          <div className="animate-slide-up w-full max-w-md mx-4 rounded-2xl overflow-hidden"
            style={{ border: '2px solid var(--yellow)', boxShadow: '0 0 60px rgba(215,153,33,0.35)' }}>

            {/* Card header */}
            <div className="px-6 pt-6 pb-4 text-center"
              style={{ background: 'var(--bg1)' }}>
              <div className="font-display text-5xl mb-1" style={{ color: 'var(--yellow-b, #fabd2f)' }}>
                🎤
              </div>
              <h2 className="font-display text-3xl tracking-widest mb-1"
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
              <div className="font-display text-5xl uppercase tracking-widest"
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
