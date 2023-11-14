import { ethers } from "hardhat"

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
export const HARDHAT_CHAINID = 31337
export const bn = (value: any) => ethers.BigNumber.from(value)
export const parseEther = (value: string) => ethers.utils.parseEther(value)
export function isTDay(timestamp: any) {
    return timestamp % 86400 <= 28800
}

function bigNumberify(n: number) {
    return ethers.BigNumber.from(n)
}

export function exPow(n: number, decimals: number) {
    return bigNumberify(n).mul(bigNumberify(10).pow(decimals))
}

async function send(provider: any, method: any, params: any = []) {
    await provider.send(method, params)
}

export async function mineBlock(provider: any) {
    await send(provider, "evm_mine")
}

export async function increaseTime(provider: any, seconds: any) {
    await send(provider, "evm_increaseTime", [seconds])
}

export async function getBlockTime(provider: any) {
    const blockNumber = await provider.getBlockNumber()
    const block = await provider.getBlock(blockNumber)
    return block.timestamp
}
