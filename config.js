// Edit these each year. Everything else is pulled live.
window.PICKEM_CONFIG = {
  title: "Thanksgiving Pick'Em",

  // Google Sheet (must be shared "anyone with the link can view")
  sheetId: "1X_LgtIODE5TY9jv9GXcwqWGqL_oNW9UXm67jMPSS_jA",
  gids: {
    rules: "446657809",
    scoresheet: "1879107624",
    playersToChooseFrom: "717640711",
  },

  // NFL week + Sleeper league whose scoring settings are used (half PPR, "The Snake").
  season: 2026,
  week: 12,
  sleeperLeagueId: "1385400813098139648",

  // ESPN scoreboard date range covering Thursday + Friday games (YYYYMMDD-YYYYMMDD)
  espnDates: "20261126-20261127",

  // Tiebreaker game (Sleeper/ESPN team abbreviations): total points scored
  tiebreakerGame: ["DEN", "PIT"],

  // Fallback payout split if the Rules tab can't be read
  buyIn: 30,
  payoutSplit: [2 / 3, 0.2639, 0.0694],

  lockTime: "2026-11-26T12:30:00-05:00",
  refreshSeconds: 60,
  simulations: 10000,
};
