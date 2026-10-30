const Inventory = require('../models/Inventory');
const Reservation = require('../models/Reservation');

// An order keeps its picked stock only until otpExpiresAt. Pending orders simply
// lose their hold; paid orders are marked refunded because the customer never
// reached the machine inside the 15-minute pickup window.
async function releaseExpiredReservations(now = new Date()) {
  const expired = await Reservation.find({ status: { $in: ['PENDING', 'PAID'] }, otpExpiresAt: { $lte: now } }).select('_id machine items status total');
  let released = 0;
  for (const reservation of expired) {
    const refund = reservation.status === 'PAID'
      ? { refundedAt: now, refundAmount: Math.round((reservation.total || 0) * 100) / 100 }
      : {};
    const result = await Reservation.updateOne(
      { _id: reservation._id, status: reservation.status, otpExpiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED', cancelledAt: now, ...refund }, $unset: { otpHash: 1, pickupOtp: 1 } },
    );
    if (!result.modifiedCount) continue;
    for (const item of reservation.items) {
      await Inventory.updateOne(
        { machine: reservation.machine, product: item.product, reserved: { $gte: item.quantity } },
        { $inc: { reserved: -item.quantity } },
      );
    }
    released += 1;
  }
  return released;
}

module.exports = { releaseExpiredReservations };
