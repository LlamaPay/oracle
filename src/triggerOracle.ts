import { ethers } from "ethers"
import request, { gql } from "graphql-request";
import { getRollingPrice24h, now, weeklyAveragePriceCg } from "./prices/getPrice";

interface Payment {
    streamId: string;
    lastPaid: string;
    starts: string;
    ends: string;
    frequency: string;
    pool: {
        token: {
            address: string;
        },
        poolContract: string;
    }
}

interface PPayment extends Payment {
    nextPayment: number;
}

const Payments = gql`
{
    payments {
        streamId,
        lastPaid,
        ends,
        frequency,
        pool {
            token {
                address
            },
            poolContract
        }
    }
}`

async function triggerOracleForChain(subgraphUrl:string, rpcUrl:string, priceFunction:(chain:number, token:string)=>Promise<number>){
    const currentTime = now()
    const { payments } = (await request(subgraphUrl, Payments)) as {
        payments: Payment[]
    }
    const paymentsReady = payments.map(p => {
        const nextPayment = Math.min(Number(p.lastPaid) + Number(p.frequency), Number(p.ends))
        return { ...p, nextPayment }
    }).filter(p => {
        if (p.lastPaid === p.ends) {
            return false
        }
        return p.nextPayment < currentTime
    })
    if (paymentsReady.length === 0) return
    const groups = Object.values(paymentsReady.reduce((acc, p) => {
        const id = `${p.pool.poolContract}-${p.pool.token}-${p.nextPayment}`
        acc[id] = (acc[id] ?? []).concat(p)
        return acc
    }, {} as { [id: string]: PPayment[] }))

    const wallet = new ethers.Wallet(process.env.LLAMAPAY_ORACLE_PRIVATE_KEY!, new ethers.providers.JsonRpcProvider(rpcUrl))
    const chainId = await wallet.getChainId()
    for (const group of groups) {
        const contractAddress = group[0].pool.poolContract
        try {
            const contract = new ethers.Contract(contractAddress, [
                "function withdraw(uint256[] calldata ids,address _token,uint256 _price,uint256 _timestamp)"
            ], wallet)
            const token = group[0].pool.token.address
            const tokenContract = new ethers.Contract(token, [
                "function decimals() view returns (uint8)"
            ], wallet)
            const decimals = await tokenContract.decimals()
            const timestamp = group[0].nextPayment
            const price = await priceFunction(chainId, token.toLowerCase())
            const decimalOffset = 10 ** (18 - Number(decimals))
            const formattedPrice = BigInt(1e28 / (price * decimalOffset)).toString()
            //console.log(price, group.map(p=>p.streamId), token, formattedPrice, timestamp)
            await contract.withdraw(group.map(p => p.streamId), token, formattedPrice, timestamp)
        } catch (e) {
            console.error(`Couldn't handle withdrawals for pool ${contractAddress}`, e)
        }
    }
}

const handler = async (): Promise<any> => {
    await Promise.all([
        triggerOracleForChain("https://api.thegraph.com/subgraphs/name/nemusonaneko/scheduledtransfers-optimism", "https://rpc.ankr.com/optimism", getRollingPrice24h),
        triggerOracleForChain("https://api.thegraph.com/subgraphs/name/nemusonaneko/scheduled-transfers-mainnet", "https://eth.llamarpc.com", weeklyAveragePriceCg)
    ])

    return {
        statusCode: 200,
        body: "oke",
    };
};

export default handler;
