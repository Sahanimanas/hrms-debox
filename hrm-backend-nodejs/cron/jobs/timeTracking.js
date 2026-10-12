const { closeDay } = require('../../services/time/dailyClose');

module.exports = [
  {
    name: 'attendance-daily-close',
    schedule: '30 1 * * *',
    description: "Flag missed clock-outs and (if enabled) mark yesterday's absentees",
    run: (db) => closeDay(db)
  }
];
