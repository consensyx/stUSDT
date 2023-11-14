import { web3 } from "hardhat"
import { ecsign } from "ethereumjs-util"

const permitTypeHash = web3.utils.keccak256(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)",
)

function buildPermitDigest(
    domainSeparator: string,
    owner: string,
    spender: string,
    value: number,
    nonce: number,
    deadline: number,
) {
    return web3.utils.keccak256(
        "0x1901" +
            strip0x(domainSeparator) +
            strip0x(
                web3.utils.keccak256(
                    web3.eth.abi.encodeParameters(
                        ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
                        [permitTypeHash, owner, spender, value, nonce, deadline],
                    ),
                ),
            ),
    )
}

export function signPermit(
    owner: string,
    spender: string,
    value: number,
    nonce: number,
    deadline: number,
    domainSeparator: string,
    privateKey: string,
) {
    const digest = buildPermitDigest(domainSeparator, owner, spender, value, nonce, deadline)
    const { v, r, s } = ecsign(bufferFromHexString(digest), bufferFromHexString(privateKey))
    return { v, r: hexStringFromBuffer(r), s: hexStringFromBuffer(s) }
}

export function buildDomainSeparator(name: string, version: string, chainId: number, verifyingContract: string) {
    return web3.utils.keccak256(
        web3.eth.abi.encodeParameters(
            ["bytes32", "bytes32", "bytes32", "uint256", "address"],
            [
                web3.utils.keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
                ),
                web3.utils.keccak256(name),
                web3.utils.keccak256(version),
                chainId,
                verifyingContract,
            ],
        ),
    )
}

function strip0x(s: string) {
    return s.slice(0, 2) === "0x" ? s.slice(2) : s
}

function hexStringFromBuffer(buf: Buffer) {
    return "0x" + buf.toString("hex")
}

function bufferFromHexString(hex: string) {
    return Buffer.from(strip0x(hex), "hex")
}
