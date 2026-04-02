const generateLobbyCode = async (queryFn) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  let attempts = 0;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const { rows } = await queryFn("SELECT id FROM game_lobbies WHERE code = $1 AND status != 'finished'", [code]);
    if (!rows[0]) break;
    attempts++;
  } while (attempts < 10);
  return code;
};

module.exports = { generateLobbyCode };
