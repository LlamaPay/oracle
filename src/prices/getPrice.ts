import fetch from "node-fetch";

function findMedian(points:number[]){
    return points.sort()[Math.round(points.length/2)]
}

function twap(prices:[number, number][]){ // [timestamp, price]
    const sorted = prices.sort((a, b)=>a[0]-b[0])
    let twap = 0;
    for(let i=1; i<sorted.length; i++){
        const deltaTime = sorted[i][0]-sorted[i-1][0]
        const avgPrice = (sorted[i][1] + sorted[i-1][1])/2
        twap += deltaTime*avgPrice
    }
    return twap/(sorted[sorted.length-1][0]-sorted[0][0])
}

async function cgPrices(token:string, start:number, end:number){
    const {prices} = await fetch(`https://api.coingecko.com/api/v3/coins/${token}/market_chart/range?vs_currency=usd&from=${start}&to=${end}`).then(r=>r.json())
    return prices
}

async function cg(token:string, start:number, end:number){
    const prices = await cgPrices(token, start, end)
    return findMedian(prices.map((p:any)=>p[1]))
}

async function binance(token:string, start:number, end:number){
    const prices = await fetch(`https://api.binance.com/api/v3/klines?symbol=${token}&interval=30m&limit=1000&startTime=${start*1e3}&endTime=${end*1e3}`).then(r=>r.json())
    /*
Docs: https://binance-docs.github.io/apidocs/spot/en/#compressed-aggregate-trades-list
[
  [
    1499040000000,      // Kline open time
    "0.01634790",       // Open price
    "0.80000000",       // High price
    "0.01575800",       // Low price
    "0.01577100",       // Close price
    "148976.11427815",  // Volume
    1499644799999,      // Kline Close time
    "2434.19055334",    // Quote asset volume
    308,                // Number of trades
    "1756.87402397",    // Taker buy base asset volume
    "28.46694368",      // Taker buy quote asset volume
    "0"                 // Unused field, ignore.
  ]
]
*/
    return findMedian(prices.map((p:any)=>(Number(p[2])+Number(p[3]))/2))
}

export const now = () => Math.floor(Date.now()/1e3)
const DAY = 24*3600

export async function getRollingPrice24h(chainId:number, token:string){
    const end = now();
    const start = end - DAY;
    const tokenIds = tokens[chainId]?.[token]
    if(tokenIds === undefined || tokenIds.length !== 2){
        throw new Error(`Token ${chainId}:${token} is not recognized`)
    }
    const results = await Promise.all([
        cg(tokenIds[0], start, end),
        binance(tokenIds[1], start,end),
    ])
    const change = Math.max(results[0], results[1])/Math.min(results[0], results[1])
    if(change > 1.2){
        throw new Error("Price change is >20% between sources")
    }
    return (results[0]+results[1])/2
}

export async function weeklyAveragePriceCg(chainId:number, token:string){
    const end = now();
    const start = end - 7*DAY;
    const tokenIds = tokens[chainId]?.[token]
    if(tokenIds === undefined){
        throw new Error(`Token ${chainId}:${token} is not recognized`)
    }
    const results = await cgPrices(tokenIds[0], start, end)
    return twap(results)
}

const tokens = {
    1:{
        "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": ["bitcoin", "BTCUSDT"], // WBTC
        "0x1e4746dc744503b53b4a082cb3607b169a289090": ["ipor"],
    },
    5:{
        "0x58d7ccbe88fe805665eb0b6c219f2c27d351e649": ["ethereum", "ETHUSDT"], // ETH from https://token-faucet.defillama.com/
    },
    10:{
        "0x4200000000000000000000000000000000000042": ["optimism", "OPUSDT"], // OP
    },
} as any