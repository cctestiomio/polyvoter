// app/utils/taLogic.ts (or inside your page)

export function calculateTaAccuracy(
  prices: number[], 
  outcomes: ("Yes" | "No")[], 
  window: number = 30, // INCREASED from 15 to 30 for better accuracy
  threshold: number = 75 // RSI/Score threshold
) {
  // ... your existing TA logic here ...
  // If using RSI:
  // let rsi = calculateRSI(prices, window);
  // let signal = rsi > threshold ? "Buy" : (rsi < 100-threshold ? "Sell" : "Neutral");
  
  // Return improved stats
}
