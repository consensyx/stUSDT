import { ethers } from "hardhat"
import { expect } from "chai"
import { time } from "@openzeppelin/test-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { parseEther, isTDay, ZERO_ADDRESS, exPow, bn } from "./utils/common"
import { RWAFactory, RWAPool, MockERC20 } from "../typechain"

describe("StUSD", () => {
    let gov: SignerWithAddress
    let rebaseAdmin: SignerWithAddress
    let reserve: SignerWithAddress
    let receipient: SignerWithAddress
    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress
    let factory: RWAFactory
    let usdc: MockERC20
    let stUSD: RWAPool

    const name = "aUSDC"
    const symbol = "aUSDC"
    const DAY_SECONDS = 86400

    beforeEach(async () => {
        ;[gov, rebaseAdmin, reserve, receipient, user1, user2, user3] = await ethers.getSigners()

        const RWAFactory = await ethers.getContractFactory("RWAFactory")
        const mockERC20 = await ethers.getContractFactory("MockERC20")

        factory = await RWAFactory.deploy()
        usdc = await mockERC20.deploy("USDC", "USDC")

        // deploy StUSD token (RWA pool)
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

        // set protocol fee to 0
        await stUSD.connect(gov).setProtocolFee(0, 0)
        await stUSD.connect(gov).setMaximumTotalStakingLimit(parseEther("1000000000"))

        // mint stablecoion
        await usdc.mint(gov.address, parseEther("100000"))
        await usdc.mint(user1.address, parseEther("100000"))
        // approve USDC for stUSD contract
        await usdc.connect(gov).approve(stUSD.address, parseEther("10000"))
        await usdc.connect(user1).approve(stUSD.address, parseEther("10000"))

        let latestTime = (await time.latest()).toNumber()
        if (!isTDay(latestTime)) {
            await time.increaseTo(Math.floor(latestTime / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS)
        }

        latestTime = (await time.latest()).toNumber()
        expect(isTDay(latestTime)).to.be.eq(true)
    })

    it("name()", async () => {
        expect(await stUSD.name()).to.equal(name)
    })

    it("symbol", async () => {
        expect(await stUSD.symbol()).to.be.eq(symbol)
    })

    it("decimals()", async () => {
        expect(await stUSD.decimals()).to.be.equal(18)
    })

    it("allowances()", async () => {
        expect(await stUSD.allowance(user1.address, user2.address)).to.be.eq(0)

        await stUSD.connect(user1).approve(user2.address, exPow(100, 18))
        expect(await stUSD.allowance(user1.address, user2.address)).to.be.eq(exPow(100, 18))
    })

    describe("increaseAllowance()", async () => {
        it("when the spender is the zero address", async function () {
            await expect(stUSD.connect(gov).increaseAllowance(ZERO_ADDRESS, parseEther("1"))).to.be.revertedWith(
                "ERC20: approve to the zero address",
            )
        })

        describe("when the sender has enough balance", async () => {
            beforeEach(async () => {
                await stUSD.connect(gov).subscribe(gov.address, parseEther("100"))
                expect(await stUSD.balanceOf(gov.address)).to.be.eq(parseEther("100"))
            })

            it("emits an approval event", async function () {
                let value = parseEther("1")
                const receipt = await stUSD.connect(gov).increaseAllowance(user1.address, value)
                await expect(receipt).to.emit(stUSD, "Approval").withArgs(gov.address, user1.address, value) // Modify this line based on your token value type
            })

            describe("when there was no approved value before", function () {
                it("approves the requested value", async function () {
                    let value = parseEther("1")
                    await stUSD.connect(gov).increaseAllowance(user1.address, value)

                    expect(await stUSD.allowance(gov.address, user1.address)).to.be.eq(value)
                })
            })

            describe("when the spender had an approved value", function () {
                it("increases the spender allowance adding the requested value", async function () {
                    await stUSD.connect(gov).approve(user1.address, parseEther("1"))

                    await stUSD.connect(gov).increaseAllowance(user1.address, parseEther("1"))

                    expect(await stUSD.allowance(gov.address, user1.address)).to.be.eq(parseEther("2"))
                })
            })

            describe("when the sender does not have enough balance", function () {
                beforeEach(async function () {
                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it("emits an approval event", async function () {
                    let value = parseEther("1")
                    const receipt = await stUSD.connect(user1).increaseAllowance(user2.address, value)
                    await expect(receipt).to.emit(stUSD, "Approval").withArgs(user1.address, user2.address, value)
                })

                describe("when there was no approved value before", function () {
                    it("approves the requested value", async function () {
                        let value = parseEther("1")
                        await stUSD.connect(user1).increaseAllowance(user2.address, value)

                        expect(await stUSD.allowance(user1.address, user2.address)).to.be.eq(value)
                    })
                })

                describe("when the spender had an approved value", function () {
                    it("increases the spender allowance adding the requested value", async function () {
                        await stUSD.connect(user1).approve(user2.address, parseEther("1"))
                        await stUSD.connect(user1).increaseAllowance(user2.address, parseEther("1"))

                        expect(await stUSD.allowance(user1.address, user2.address)).to.be.eq(parseEther("2"))
                    })
                })
            })
        })
    })

    describe("decrease allowance", async () => {
        let spender = user1.address
        let initialSupply = parseEther("100")

        beforeEach(async () => {
            await stUSD.connect(gov).subscribe(gov.address, initialSupply)
            expect(await stUSD.balanceOf(gov.address)).to.be.eq(initialSupply)
        })

        it("when the spender is the zero address", async function () {
            await expect(stUSD.connect(gov).decreaseAllowance(ZERO_ADDRESS, initialSupply)).to.be.revertedWith(
                "ERC20: approve from the zero address",
            )
        })

        function shouldDecreaseApproval(value: any) {
            beforeEach(async () => {
                await stUSD.connect(gov).subscribe(gov.address, initialSupply)
                expect(await stUSD.balanceOf(gov.address)).to.be.eq(initialSupply)
            })

            describe("when there was no approved value before", function () {
                it("reverts", async function () {
                    const allowance = await stUSD.allowance(gov.address, spender)

                    await expect(stUSD.connect(gov).decreaseAllowance(spender, value)).to.be.revertedWith(
                        "ERC20: insufficient allowance",
                    )
                })
            })

            describe("when the spender had an approved value", function () {
                const approvedValue = value

                beforeEach(async function () {
                    await stUSD.connect(gov).approve(spender, approvedValue)
                })

                it("emits an approval event", async function () {
                    const receipt = await stUSD.connect(gov).decreaseAllowance(spender, value)
                    await expect(receipt).to.emit(stUSD, "Approval").withArgs(gov.address, spender, value)
                })

                it("decreases the spender allowance subtracting the requested value", async function () {
                    await stUSD.connect(gov).decreaseAllowance(spender, value, approvedValue.sub(parseEther("1")))
                    expect(await this.token.allowance(gov.address, spender)).to.be.eq(parseEther("1"))
                })

                it("sets the allowance to zero when all allowance is removed", async function () {
                    await stUSD.connect(gov).decreaseAllowance(spender, approvedValue)
                    expect(await stUSD.allowance(gov.address, spender)).to.be.eq(0)
                })

                it("reverts when more than the full allowance is removed", async function () {
                    await expect(stUSD.connect(gov).decreaseAllowance(spender, value.add(1))).to.be.revertedWith(
                        "ERC20: insufficient allowance",
                    )
                })
            })
        }

        describe("when the sender has enough balance", function () {
            const value = initialSupply
            shouldDecreaseApproval(value)
        })

        describe("when the sender does not have enough balance", function () {
            const value = initialSupply.add(1)
            shouldDecreaseApproval(value)
        })
    })

    context("transferFrom", async () => {
        beforeEach(async () => {
            await stUSD.connect(user1).subscribe(user1.address, parseEther("100"))
            expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("100"))

            await stUSD.connect(user1).approve(user2.address, parseEther("50"))
            await stUSD.connect(user3).approve(user2.address, parseEther("50"))
        })

        it("recipient is zero address", async () => {
            await expect(
                stUSD.connect(user2).transferFrom(user1.address, ZERO_ADDRESS, parseEther("1")),
            ).to.be.revertedWith("ZeroAddress")
        })

        it("transfer to stUSD contract itself", async () => {
            await expect(
                stUSD.connect(user2).transferFrom(user1.address, stUSD.address, parseEther("1")),
            ).to.be.revertedWith("TransferSelfContract")
        })

        it("sender is zero address", async () => {
            await expect(
                stUSD.connect(user2).transferFrom(ZERO_ADDRESS, user3.address, parseEther("0")),
            ).to.be.revertedWith("ERC20: approve from the zero address")
        })

        it("exceeds allowance", async () => {
            await expect(
                stUSD.connect(user2).transferFrom(user1.address, user3.address, parseEther("51")),
            ).to.be.revertedWith("ERC20: insufficient allowance")
        })

        it("reverts if owner have no tokens", async () => {
            await expect(stUSD.connect(user2).transferFrom(user3.address, user1.address, parseEther("51"))).to.be
                .reverted
        })

        it("transferFrom works and emits events", async () => {
            const amount = parseEther("50")
            const sharesAmount = await stUSD.getSharesByUnderlying(amount)
            const receipt = await stUSD.connect(user2).transferFrom(user1.address, user3.address, amount)

            await expect(receipt).to.emit(stUSD, "Transfer").withArgs(user1.address, user3.address, amount)
            await expect(receipt).to.emit(stUSD, "TransferShares").withArgs(user1.address, user3.address, sharesAmount)

            expect(await stUSD.allowance(user1.address, user2.address)).to.be.eq(0)
            expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
            expect(await stUSD.balanceOf(user3.address)).to.be.eq(parseEther("50"))
        })
    })
})
