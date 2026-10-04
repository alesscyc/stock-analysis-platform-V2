export function validateTicket(input, mode = "live") {
  const symbol = String(input.symbol || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol))
    throw new Error("A valid stock symbol is required. / 請提供有效股票代號。");
  if (!["BUY", "SELL"].includes(input.side))
    throw new Error("Select BUY or SELL. / 請選擇買入或賣出。");
  const quantity = Number(input.quantity),
    limitPrice = Number(input.limitPrice),
    tif = input.tif;
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw new Error(
      "Quantity must be positive whole shares. / 股數必須為正整數。",
    );
  if (
    !Number.isFinite(limitPrice) ||
    limitPrice <= 0 ||
    !Number.isFinite(quantity * limitPrice)
  )
    throw new Error(
      "Limit price must be a positive finite amount. / 限價必須為有效正數。",
    );
  if (!["DAY", "GTC", "IOC", "FOK"].includes(tif))
    throw new Error("Unsupported time in force. / 不支援的有效期限。");
  const ticket = { symbol, side: input.side, quantity, limitPrice, tif };
  for (const key of ["takeProfit", "stopLoss"])
    if (input[key] !== "" && input[key] != null) {
      const value = Number(input[key]);
      if (!Number.isFinite(value) || value <= 0)
        throw new Error("Exit prices must be positive. / 出場價格必須為正數。");
      ticket[key] = value;
    }
  if (
    ticket.takeProfit != null &&
    (ticket.side === "BUY"
      ? ticket.takeProfit <= limitPrice
      : ticket.takeProfit >= limitPrice)
  )
    throw new Error(
      "Take-profit must be beyond the limit price in the profitable direction. / 停利價格必須位於限價的獲利方向。",
    );
  if (
    ticket.stopLoss != null &&
    (ticket.side === "BUY"
      ? ticket.stopLoss >= limitPrice
      : ticket.stopLoss <= limitPrice)
  )
    throw new Error(
      "Stop-loss must be beyond the limit price in the loss direction. / 停損價格必須位於限價的虧損方向。",
    );
  if (
    mode === "paper" &&
    (ticket.takeProfit || ticket.stopLoss) &&
    (ticket.side !== "BUY" || !["DAY", "GTC"].includes(tif))
  )
    throw new Error(
      "Paper brackets support BUY with DAY or GTC only. / 模擬括號單僅支援 DAY 或 GTC 買入。",
    );
  return ticket;
}
