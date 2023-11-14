import { ethers } from "hardhat"

async function main() {
    const ERC20 = await ethers.getContractFactory("MockERC20")
    const token = await ERC20.deploy("USDC", "USDC")
    console.log("ERC20 token address:", token.address)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
