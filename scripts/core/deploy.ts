import { ethers } from "hardhat"
async function main() {
    const RWAFactory = await ethers.getContractFactory("RWAFactory")

    const name = "stUSD"
    const symbol = "stUSD"
    const usd = "0x448cc47f9207bdc89122b6c7c515e32a2fed4556"
    const admin = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"
    const minter = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"
    const burner = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"
    const rebaseAdmin = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"
    const reserve = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"
    const receipient = "0x06B4B48d14426ABaf02B95470A70611211E5A6bD"

    const factory = await RWAFactory.deploy()
    console.log("factory deployed address:", factory.address)

    // let factory = await ethers.getContractAt(
    //   "RWAFactory",
    //   "0x255c5de50b3fc74b3f25d794a03e7b7c4686cd59"
    // )

    const tx = await factory.createPool(name, symbol, usd, admin, minter, burner, rebaseAdmin, reserve, receipient)

    await tx.wait()
    let poolAddress = await factory.pools(0)
    console.log("pool deployed address:", poolAddress)
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
