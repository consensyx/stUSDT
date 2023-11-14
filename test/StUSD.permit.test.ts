import { ethers } from "hardhat"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { time } from "@openzeppelin/test-helpers"
import { expect } from "chai"
import { Wallet } from "ethers"
import { HARDHAT_CHAINID } from "./utils/common"
import { buildDomainSeparator, signPermit } from "./utils/permit"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { RWAFactory, RWAPool, MockERC20 } from "../typechain"

declare var hre: HardhatRuntimeEnvironment

describe("StUSD Permit Test", () => {
    let gov: SignerWithAddress
    let rebaseAdmin: SignerWithAddress
    let reserve: SignerWithAddress
    let receipient: SignerWithAddress
    let user1: SignerWithAddress
    let factory: RWAFactory
    let usdc: MockERC20
    let stUSD: RWAPool
    let chainId: number
    let owner: Wallet
    let spender: Wallet
    let domainSeparator: string

    const name = "aUSDC"
    const symbol = "aUSDC"

    beforeEach(async () => {
        ;[gov, rebaseAdmin, reserve, receipient, user1] = await ethers.getSigners()

        // account for sign permit
        owner = Wallet.createRandom()
        spender = Wallet.createRandom()

        // setup StUSD
        const RWAFactory = await ethers.getContractFactory("RWAFactory")
        const erc20 = await ethers.getContractFactory("MockERC20")

        factory = await RWAFactory.deploy()
        usdc = await erc20.deploy("USDC", "USDC")

        await factory.createPool(
            name,
            symbol,
            usdc.address,
            gov.address, // admin
            gov.address, // minter
            gov.address, // burner
            rebaseAdmin.address,
            reserve.address,
            receipient.address,
        )
        stUSD = (await ethers.getContractAt("RWAPool", await factory.pools(0))) as RWAPool

        chainId = hre.network.config.chainId || HARDHAT_CHAINID
        domainSeparator = buildDomainSeparator(name, "1", chainId, stUSD.address)
    })

    it("initial nonce is 0", async function () {
        expect(await stUSD.nonces(user1.address)).to.be.eq(0)
    })

    it("domain separator", async function () {
        expect(await stUSD.DOMAIN_SEPARATOR()).to.be.eq(domainSeparator)
    })

    it("permit owner signature", async function () {
        let allowance = 1000000000
        // deadline + 10s
        let deadline = (await time.latest()) + 10
        let nonce = 0
        // allowance(owner, spender) is zero
        expect(await stUSD.allowance(owner.address, spender.address)).to.be.eq(0)
        // owner inital nonce is zero
        expect(await stUSD.nonces(owner.address)).to.be.eq(0)

        let { v, r, s } = signPermit(
            owner.address,
            spender.address,
            allowance,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        )

        // random account submits the permit
        await stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s)

        // check allowance is updated
        expect(await stUSD.allowance(owner.address, spender.address)).to.be.eq(allowance)

        // increment nonce
        nonce = 1
        allowance = 123456789
        ;({ v, r, s } = signPermit(
            owner.address,
            spender.address,
            allowance,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        ))

        // submit the permit
        await stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s)

        // check allowance is updated
        expect(await stUSD.allowance(owner.address, spender.address)).to.be.eq(allowance)
    })

    it("rejects reused signature", async function () {
        let allowance = 1000000000
        let deadline = (await time.latest()) + 10

        let nonce = 0
        let { v, r, s } = signPermit(
            owner.address,
            spender.address,
            allowance,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        )

        await stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s)

        // check that allowance is updated
        expect(await stUSD.allowance(owner.address, spender.address)).to.be.eq(allowance)

        // reuse same permit signature will be reverted
        await expect(
            stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s),
        ).to.be.revertedWith("ERC20Permit: invalid signature")
    })

    it("rejects non-owner signature", async function () {
        let other = Wallet.createRandom()
        let allowance = 1000000000
        let deadline = (await time.latest()) + 10
        let nonce = 0

        let { v, r, s } = signPermit(
            other.address, // other account
            spender.address,
            allowance,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        )

        await expect(
            stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s),
        ).to.be.revertedWith("ERC20Permit: invalid signature")
    })

    it("expired permit will be rejected", async function () {
        let allowance = 1000000000
        let deadline = (await time.latest()) + 10
        let nonce = 0

        let { v, r, s } = signPermit(
            owner.address,
            spender.address,
            allowance,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        )

        // time increase to the time behind deadline
        await time.increaseTo(deadline + 10)

        await expect(
            stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s),
        ).to.be.revertedWith("ERC20Permit: expired deadline")
    })

    it("wrong signature message will be rejected", async function () {
        let allowance = 1000000000
        let deadline = (await time.latest()) + 10
        let nonce = 0

        let { v, r, s } = signPermit(
            owner.address,
            spender.address,
            allowance + 100000,
            nonce,
            deadline,
            domainSeparator,
            owner.privateKey,
        )

        await expect(
            stUSD.connect(user1).permit(owner.address, spender.address, allowance, deadline, v, r, s),
        ).to.be.revertedWith("ERC20Permit: invalid signature")
    })
})
