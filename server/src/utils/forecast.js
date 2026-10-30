function projectStock({ available, reserved = 0, lowStockThreshold = 5, unitsSold = 0, days = 30 }) {
  const safeDays = Math.max(1, Number(days) || 1);
  const safeAvailable = Math.max(0, Number(available) || 0);
  const safeReserved = Math.max(0, Number(reserved) || 0);
  const safeThreshold = Math.max(0, Number(lowStockThreshold) || 0);
  const safeUnitsSold = Math.max(0, Number(unitsSold) || 0);
  const dailyAverage = safeUnitsSold / safeDays;
  const daysRemaining = dailyAverage > 0 ? safeAvailable / dailyAverage : null;
  const target = Math.max(safeThreshold * 2, Math.ceil(dailyAverage * 7));

  return {
    available: safeAvailable,
    reserved: safeReserved,
    dailyAverage: Math.round(dailyAverage * 100) / 100,
    daysRemaining: daysRemaining === null ? null : Math.round(daysRemaining * 10) / 10,
    suggestedRestock: Math.max(0, target - safeAvailable),
  };
}

module.exports = { projectStock };
