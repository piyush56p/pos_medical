const moment = require("moment");

const DATE_FORMAT = "DD-MMM-YYYY";
const moneyFormat = (amount, locale = "en-US") => new Intl.NumberFormat(locale).format(amount);
const isExpired = (dueDate) => moment().isSameOrAfter(dueDate);
const daysToExpire = (dueDate) => {
  const today = moment();
  const expiryDate = moment(dueDate, DATE_FORMAT);
  return expiryDate.isSameOrBefore(today, "day") ? 0 : expiryDate.diff(today, "days");
};
const getStockStatus = (currentStock, minimumStock) => {
  const stock = Number(currentStock);
  const minimum = Number(minimumStock);
  if (Number.isNaN(stock) || Number.isNaN(minimum)) {
    throw new Error("Invalid input: both currentStock and minimumStock should be numbers.");
  }
  if (stock <= 0) return 0;
  return stock <= minimum ? -1 : 1;
};

module.exports = { DATE_FORMAT, moneyFormat, isExpired, daysToExpire, getStockStatus };