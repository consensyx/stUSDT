import { ethers } from "hardhat"
import { expect } from "chai"
import { time } from "@openzeppelin/test-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { parseEther, isTDay, ZERO_ADDRESS, exPow } from "./utils/common"
import { RWAFactory, RWAPool, BlockList, MockRWAPool, MockERC20 } from "../typechain"

describe("RWAPool", () => {
    let gov: SignerWithAddress
    let rebaseAdmin: SignerWithAddress
    let reserve: SignerWithAddress
    let receipient: SignerWithAddress
    let user1: SignerWithAddress
    let user2: SignerWithAddress
    let user3: SignerWithAddress
    let factory: RWAFactory
    let usdc: MockERC20
    let pool: RWAPool
    let blocklist: BlockList

    const FEE_BASIS_POINTS = 10000
    const SUBSCRIBE_FEE = 10
    const REDEEM_FEE = 10
    const DAY_SECONDS = 86400
    const T_DAY_SECONDS = 28800
    const minimumRedeemInterval = 518400

    beforeEach(async () => {
        ;[gov, rebaseAdmin, reserve, receipient, user1, user2, user3] = await ethers.getSigners()

        const RWAFactory = await ethers.getContractFactory("RWAFactory")
        const MockERC20 = await ethers.getContractFactory("MockERC20")
        const BlockList = await ethers.getContractFactory("BlockList")

        factory = await RWAFactory.deploy()
        usdc = await MockERC20.deploy("USDC", "USDC")
        blocklist = await BlockList.deploy()

        // deploy pool RWA pool
        await factory.createPool(
            "stUSDT",
            "stUSDT",
            usdc.address,
            gov.address, // admin
            gov.address, // minter
            gov.address, // burner
            rebaseAdmin.address,
            reserve.address,
            receipient.address,
        )

        pool = (await ethers.getContractAt("RWAPool", await factory.pools(0))) as RWAPool

        // mint stablecoion
        await usdc.mint(gov.address, parseEther("100000"))
        await usdc.mint(reserve.address, parseEther("100000"))
        // await usdc.mint(operator.address, parseEther("100000"))
        await usdc.mint(user1.address, parseEther("100000"))
        await usdc.mint(user2.address, parseEther("100000"))
        await usdc.mint(user3.address, parseEther("100000"))

        // approve pool stablecoin
        await usdc.connect(gov).approve(pool.address, parseEther("10000"))
        // await usdc.connect(operator).approve(pool.address, parseEther("10000"))
        await usdc.connect(reserve).approve(pool.address, parseEther("10000"))
        await usdc.connect(user1).approve(pool.address, parseEther("10000"))
        await usdc.connect(user2).approve(pool.address, parseEther("10000"))
        await usdc.connect(user3).approve(pool.address, parseEther("10000"))

        // set roles and parameters
        await pool.connect(gov).setProtocolFee(10, 10)
        await pool.connect(gov).setRebaseRateLimit(5000, 5000)
        await pool.connect(gov).setMaxRedeemQueueSize(3)
        await pool.connect(gov).setMinimumSubscribeAmount(parseEther("1"))
        await pool.connect(gov).setMinimumRedeemAmount(parseEther("1"))
        await pool.connect(gov).setMaximumTotalStakingLimit(parseEther("1000000000"))
        await pool.connect(gov).setMinimumRedeemInterval("518400")
        await pool.connect(gov).setBlockList(blocklist.address)

        let latestTime = (await time.latest()).toNumber()

        if (!isTDay(latestTime)) {
            await time.increaseTo(Math.floor(latestTime / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS)
        }

        latestTime = (await time.latest()).toNumber()
        expect(isTDay(latestTime)).to.be.eq(true)
    })

    describe("Features Test", () => {
        it("subscribe in t day", async () => {
            let subscribeAmount = parseEther("0.1")

            // MIN_SUBSCRIBE_AMOUNT is 1 ether
            await expect(pool.connect(user1).subscribe(user1.address, subscribeAmount)).to.be.revertedWith(
                "SubscribeTooSmall",
            )

            subscribeAmount = parseEther("1")
            let user1BeforeBalance = await usdc.balanceOf(user1.address)
            let poolBeforeBalance = await usdc.balanceOf(pool.address)
            // user1 1st subscribe
            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let user1AfterBalance = await usdc.balanceOf(user1.address)
            let poolAfterBalance = await usdc.balanceOf(pool.address)

            await expect(user1BeforeBalance.sub(user1AfterBalance).toBigInt()).to.be.eq(subscribeAmount.toBigInt())
            await expect(poolAfterBalance.sub(poolBeforeBalance).toBigInt()).to.be.eq(subscribeAmount.toBigInt())

            // check subscribe fee
            expect((await pool.protocolFee()).toBigInt()).to.be.eq(exPow(1, 15).toBigInt())
            // check buffered fund
            expect((await pool.bufferedFund()).toBigInt()).to.be.eq(exPow(999, 15).toBigInt())
            // check unconfiremd fund
            expect((await pool.unconfirmedFund(user1.address)).toNumber()).to.be.eq(0)

            // 1st subscribe of the pool, share should be equal subscribed amount
            expect((await pool.totalShares()).toBigInt()).to.be.eq((await pool.bufferedFund()).toBigInt())
            // 1st subscribe of the pool, shares should be equal total shares
            expect((await pool.totalShares()).toBigInt()).to.be.eq((await pool.sharesOf(user1.address)).toBigInt())

            // user1 2nd subscribe
            subscribeAmount = parseEther("111")
            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            expect((await pool.protocolFee()).toBigInt()).to.be.eq(exPow(112, 15).toBigInt())
            expect((await pool.bufferedFund()).toBigInt()).to.be.eq(exPow(111888, 15).toBigInt())
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(111888, 15).toBigInt())

            // user1 subscribe for user2
            subscribeAmount = parseEther("1")
            await pool.connect(user1).subscribe(user2.address, subscribeAmount)
            expect((await pool.sharesOf(user2.address)).toBigInt()).to.be.eq(exPow(999, 15).toBigInt())
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(112887, 15).toBigInt())
            // user2 subscribe
            subscribeAmount = parseEther("7")
            await pool.connect(user2).subscribe(user2.address, subscribeAmount)
            expect((await pool.sharesOf(user2.address)).toBigInt()).to.be.eq(exPow(7992, 15).toBigInt())
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(119880, 15).toBigInt())
            // user3 subscribe
            subscribeAmount = parseEther("1.111111")
            await pool.connect(user3).subscribe(user3.address, subscribeAmount)
            expect((await pool.sharesOf(user3.address)).toBigInt()).to.be.eq(exPow(1109999889, 9).toBigInt())
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())

            let witdhrawAmount = parseEther("100")
            await pool.connect(reserve).withdrawToReserve(witdhrawAmount)
            // withdraw fund to reserve account will not change total shares and totalsupply
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())

            let fundingAmount = parseEther("50")
            await pool.connect(reserve).fundingFromReserve(fundingAmount)
            // funding from reserve account will not change total shares and totalsupply
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())

            let posIncome = parseEther("10")
            let latestNetValue = witdhrawAmount.sub(fundingAmount).add(posIncome)
            // positive rebase (+10 USDC)
            await pool.connect(rebaseAdmin).rebase(latestNetValue)
            // positive rebase will change totalsupply (USDC amount)
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(exPow(120989999889, 9).add(posIncome).toBigInt())
            // positive rebase will change total shares
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())

            let negIncome = parseEther("5")
            latestNetValue = latestNetValue.sub(negIncome)
            // negative rebase -10 USDC
            await pool.connect(rebaseAdmin).rebase(latestNetValue)
            // negative rebase will change totalsupply (USDC amount)
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(
                exPow(120989999889, 9).add(posIncome).sub(negIncome).toBigInt(),
            )
            // negative rebase will change total shares
            expect((await pool.totalShares()).toBigInt()).to.be.eq(exPow(120989999889, 9).toBigInt())

            // after rebase, the reserve account net value have changed, this make totalsupply not equal totalshares
            // user3 subscribe
            subscribeAmount = parseEther("1.111")
            await pool.connect(user3).subscribe(user3.address, subscribeAmount)
            expect(await pool.sharesOf(user3.address)).gt(exPow(2175842178, 9))
            expect(await pool.sharesOf(user3.address)).lt(exPow(2175842179, 9))
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(exPow(127099888889, 9).toBigInt())
            expect(await pool.totalShares()).gt(exPow(1220558421, 11))
            expect(await pool.totalShares()).lt(exPow(1220558422, 11))
        })

        it("subscribe in t+1 day, mintShares", async () => {
            let latestTime = (await time.latest()).toNumber()

            // make sure current time is behind t day
            if (isTDay(latestTime)) {
                await time.increaseTo(
                    Math.floor(latestTime / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS + T_DAY_SECONDS + 100,
                )
            }

            let subscribeAmount = parseEther("1")

            latestTime = (await time.latest()).toNumber()
            expect(isTDay(latestTime)).to.be.eq(false)

            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let protocolFee = subscribeAmount.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let subAfterFee = subscribeAmount.sub(protocolFee)
            // check subscribe fee
            expect(protocolFee.toBigInt()).to.be.eq((await pool.protocolFee()).toBigInt())
            // unconfiremd fund
            expect((await pool.unconfirmedFund(user1.address)).toBigInt()).to.be.eq(subAfterFee.toBigInt())
            // total shares should be 0
            expect((await pool.totalShares()).toNumber()).to.be.eq(0)

            // user1 2nd subscribe
            subscribeAmount = parseEther("111")
            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            // user1 subscribe for user2
            subscribeAmount = parseEther("1")
            await pool.connect(user1).subscribe(user2.address, subscribeAmount)

            // user2 subscribe
            subscribeAmount = parseEther("7")
            await pool.connect(user2).subscribe(user2.address, subscribeAmount)

            // user3 1st subscribe
            subscribeAmount = parseEther("1.111111")
            await pool.connect(user3).subscribe(user3.address, subscribeAmount)

            // operator can mintshares
            await pool.connect(gov).mintShares([user1.address, user2.address, user3.address])

            // withdrawToReserve
            let witdhrawAmount = parseEther("100")
            await pool.connect(reserve).withdrawToReserve(witdhrawAmount)

            // fundingFromReserve
            let fundingAmount = parseEther("50")
            await pool.connect(reserve).fundingFromReserve(fundingAmount)

            let posIncome = parseEther("10")
            let latestNetValue = witdhrawAmount.sub(fundingAmount).add(posIncome)
            // positive rebase (+10 USDC)
            await pool.connect(rebaseAdmin).rebase(latestNetValue)

            let negIncome = parseEther("5")
            latestNetValue = latestNetValue.sub(negIncome)
            // negative rebase -10 USDC
            await pool.connect(rebaseAdmin).rebase(latestNetValue)

            // user3 2nd subscribe
            subscribeAmount = parseEther("1.111")
            await pool.connect(user3).subscribe(user3.address, subscribeAmount)

            // minter can mintshares
            await pool.connect(gov).mintShares([user1.address, user2.address, user3.address])

            expect(await pool.sharesOf(user1.address)).eq(exPow(111888, 15))
            expect(await pool.sharesOf(user2.address)).eq(exPow(7992, 15))
            expect(await pool.sharesOf(user3.address)).lt(exPow(2175842179, 9))
            expect((await pool.totalSupply()).toBigInt()).to.be.eq(exPow(127099888889, 9).toBigInt())
            expect(await pool.totalShares()).gt(exPow(1220558421, 11))
            expect(await pool.totalShares()).lt(exPow(1220558422, 11))
        })

        it("redeem, burnshares, transferShares", async () => {
            let subscribeAmount = parseEther("100")

            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let beforeShare = await pool.sharesOf(user1.address)

            await pool.connect(user1).redeem(beforeShare)

            let afterShare = await pool.sharesOf(user1.address)
            // redeem will not deduct share
            expect(beforeShare.toBigInt()).to.be.eq(afterShare.toBigInt())

            // only pool owner can redeem
            await expect(pool.connect(user1).burnShares([user1.address])).to.be.revertedWith("OnlyBurner")

            await pool.connect(gov).burnShares([user1.address])

            // Burnshare and redeem apply for less than 144 hours, share will not change
            expect((await pool.sharesOf(user1.address)).toBigInt()).to.be.eq(beforeShare.toBigInt())

            // Increased time to ensure can effective burnshares
            await time.increase(minimumRedeemInterval)

            await pool.connect(gov).burnShares([user1.address])
            // after efftective burnshares, share should be 0
            expect((await pool.sharesOf(user1.address)).toNumber()).to.be.eq(0)

            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let protocolFee = subscribeAmount.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let subAfterFee = subscribeAmount.sub(protocolFee)

            // 1st redeem in queue
            await pool.connect(user1).redeem(parseEther("50"))
            await expect(pool.connect(user1).redeem(parseEther("60"))).to.be.revertedWith("ExceedBalance")

            // 2nd redeem in queue
            await pool.connect(user1).redeem(parseEther("5"))
            // 3rd redeem in queue
            await pool.connect(user1).redeem(parseEther("5"))
            // default max redeem size is 3, 4th redeem should be failed
            await expect(pool.connect(user1).redeem(parseEther("5"))).to.be.revertedWith("OverMaxRedeemSize")

            // set max redeem size to 4
            await pool.connect(gov).setMaxRedeemQueueSize(4)

            // 4th redeem in queue
            await pool.connect(user1).redeem(parseEther("5"))
            // 5th redeem should be failed
            await expect(pool.connect(user1).redeem(parseEther("5"))).to.be.revertedWith("OverMaxRedeemSize")

            // all of the redeem operation didn't  time not passed
            expect((await pool.sharesOf(user1.address)).toBigInt()).to.be.eq(subAfterFee.toBigInt())

            let availableShares = (await pool.sharesOf(user1.address)).sub(
                await pool.userPendingRedeemShares(user1.address),
            )

            // sharesOf(user) - userPendingRedeemShares = available share
            expect((await pool.sharesOf(user1.address)).sub(parseEther("65"))).to.be.eq(availableShares.toBigInt())
            expect(availableShares.toBigInt()).to.be.eq(parseEther("34.9"))

            // transfer amount > available shares should be failed
            await expect(pool.connect(user1).transferShares(user2.address, parseEther("50"))).to.be.revertedWith(
                "ExceedBalance",
            )

            // user1 transfer shares to user2
            await pool.connect(user1).transferShares(user2.address, parseEther("10"))

            expect((await pool.sharesOf(user1.address)).toBigInt()).to.be.eq(parseEther("89.9"))
            expect((await pool.sharesOf(user2.address)).toBigInt()).to.be.eq(parseEther("10"))

            // Increased time to ensure can effective burnshares
            await time.increase(minimumRedeemInterval)

            await pool.connect(gov).burnShares([user1.address])

            expect((await pool.sharesOf(user1.address)).toBigInt()).to.be.eq(parseEther("24.9"))
        })

        it("mintShares", async () => {
            let latestTime = (await time.latest()).toNumber()

            // make sure current time is behind t day
            if (isTDay(latestTime)) {
                await time.increaseTo(
                    Math.floor(latestTime / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS + T_DAY_SECONDS + 100,
                )
            }

            latestTime = (await time.latest()).toNumber()
            expect(isTDay(latestTime)).to.be.eq(false)

            let amount1 = parseEther("100")
            let amount2 = parseEther("200")
            await pool.connect(user1).subscribe(user1.address, amount1)
            await pool.connect(user2).subscribe(user2.address, amount2)

            // Increased time to ensure can mintshares
            await time.increase(minimumRedeemInterval)

            // only minter can mintShares
            await expect(pool.connect(user1).mintShares([user1.address, user2.address])).to.be.revertedWith(
                "OnlyMinter",
            )
            // only minter can mintshares
            await pool.connect(gov).mintShares([user1.address, user2.address])

            let fee1 = amount1.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let fee2 = amount2.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let subAfterFee = parseEther("300").sub(fee1.add(fee2))

            expect((await pool.protocolFee()).toBigInt()).to.be.eq(fee1.add(fee2).toBigInt())
            expect((await pool.bufferedFund()).toBigInt()).to.be.eq(subAfterFee.toBigInt())
            expect((await pool.totalSupply()).toBigInt()).to.be.eq((await pool.bufferedFund()).toBigInt())
            expect((await pool.totalUnconfirmedFund()).toNumber()).to.be.eq(0)
        })

        it("withdrawToReserve", async () => {
            let amount1 = parseEther("100")
            let amount2 = parseEther("200")

            // user1 and user2 subscribe 300 USDC
            await pool.connect(user1).subscribe(user1.address, amount1)
            await pool.connect(user2).subscribe(user2.address, amount2)

            // only pool reserve account can withdrawToReserve
            await expect(pool.connect(user1).withdrawToReserve(parseEther("100"))).to.be.revertedWith("OnlyReserve")

            // let initial withdraw amount > current buffered fund
            let withdrawAmount = parseEther("400")
            expect(withdrawAmount).to.be.gt((await pool.bufferedFund()).toBigInt())

            // over withdraw lead to underflow
            await expect(pool.connect(user1).withdrawToReserve(withdrawAmount)).to.be.reverted

            let bufferedFund = await pool.bufferedFund()

            withdrawAmount = parseEther("100")

            let beforeBalance = await usdc.balanceOf(reserve.address)

            // owner withdraw less amount should be success
            await pool.connect(reserve).withdrawToReserve(withdrawAmount)

            // withdraw amoun should be temporary convert to transient state
            expect((await pool.transientOutFund()).toBigInt()).to.be.eq(withdrawAmount.toBigInt())

            // buffered fund deduct corresponding amount usdc
            expect(bufferedFund.sub(withdrawAmount).toBigInt()).to.be.eq((await pool.bufferedFund()).toBigInt())

            // reserve account received corresponding amount usdc
            expect(beforeBalance.add(withdrawAmount).toBigInt()).to.be.eq(
                (await usdc.balanceOf(reserve.address)).toBigInt(),
            )
        })

        it("fundingFromReserve", async () => {
            let amount = parseEther("100")

            // user1 subscribe
            await pool.connect(user1).subscribe(user1.address, amount)

            let beforeBufferedFund = await pool.bufferedFund()
            let fundingAmount = parseEther("100")

            // only reserve account can withdrawToReserve
            await expect(pool.connect(user1).fundingFromReserve(fundingAmount)).to.be.revertedWith("OnlyReserve")

            // only reserve accoucnt can fundingFromReserve
            await pool.connect(reserve).fundingFromReserve(parseEther("100"))

            // reserve account received corresponding amount usdc
            expect(beforeBufferedFund.add(fundingAmount).toBigInt()).to.be.eq((await pool.bufferedFund()).toBigInt())

            // fundingAmount should be converted to transient state
            expect((await pool.transientInFund()).toBigInt()).to.be.eq(fundingAmount.toBigInt())
        })

        it("rebase", async () => {
            let amount1 = parseEther("100")
            let amount2 = parseEther("200")
            let amount3 = parseEther("300")

            await pool.connect(user1).subscribe(user1.address, amount1)
            await pool.connect(user2).subscribe(user2.address, amount2)
            await pool.connect(user2).subscribe(user3.address, amount3)

            let fee1 = amount1.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let fee2 = amount2.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let fee3 = amount3.mul(SUBSCRIBE_FEE).div(FEE_BASIS_POINTS)
            let subAfterFee = parseEther("600").sub(fee1.add(fee2).add(fee3))

            expect((await pool.protocolFee()).toBigInt()).to.be.eq(fee1.add(fee2).add(fee3).toBigInt())
            expect((await pool.bufferedFund()).toBigInt()).to.be.eq(subAfterFee.toBigInt())

            let withdrawAmount = parseEther("100")
            // withdrawToReserve
            await pool.connect(reserve).withdrawToReserve(withdrawAmount)

            // Increased one day duration
            await time.increase(DAY_SECONDS)

            // not rebase amin account can't call rebase
            await expect(pool.connect(user1).rebase(withdrawAmount)).to.be.revertedWith("OnlyRebaseAdmin")

            await pool.connect(rebaseAdmin).rebase(withdrawAmount)

            expect((await pool.reservedFund()).toBigInt()).to.be.eq(withdrawAmount.toBigInt())

            // scenario 1: reserve account net value increase
            let alphaReturn = parseEther("20")
            let newNetValue = (await pool.reservedFund()).add(alphaReturn)

            await pool.connect(rebaseAdmin).rebase(newNetValue)

            // after rebase,transient state fund should be reset to 0
            expect((await pool.transientOutFund()).toNumber()).to.be.eq(0)
            // new netvalue updated to reserved fund
            expect((await pool.reservedFund()).toBigInt()).to.be.eq(newNetValue.toBigInt())

            // scenario 2: reserve account net value decrease
            let negAlphaReturn = parseEther("50")
            newNetValue = (await pool.reservedFund()).sub(negAlphaReturn)

            await pool.connect(rebaseAdmin).rebase(newNetValue)

            // funding from reserve
            let fundingAmount = parseEther("50")
            let beforeTVL = await pool.totalLockedFund()
            await pool.connect(reserve).fundingFromReserve(fundingAmount)
            // after fundingFromReserve, convert to transient state
            expect((await pool.transientInFund()).toBigInt()).to.be.eq(fundingAmount.toBigInt())

            // scenario 3: reserve account net value not change
            newNetValue = newNetValue.sub(fundingAmount)
            await pool.connect(rebaseAdmin).rebase(newNetValue)
            // after rebase transientInFund reset to 0
            expect((await pool.transientInFund()).toNumber()).to.be.eq(0)

            // if netvalue not changed, total value will not changed
            let afterTVL = await pool.totalLockedFund()
            expect(beforeTVL.toBigInt()).to.be.eq(afterTVL.toBigInt())
        })

        it("setReserve", async () => {
            expect(await pool.reserve()).eq(reserve.address)

            // only owner can set reserve account
            await expect(pool.connect(user1).setReserve(user1.address)).to.be.revertedWith("OnlyAdmin")

            // set user1 as reserve account
            await pool.connect(gov).setReserve(user1.address)

            expect(await pool.reserve()).eq(user1.address)

            await expect(pool.connect(gov).setReserve(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress")
        })

        it("setFeeReceipient", async () => {
            expect(await pool.feeReceipient()).eq(receipient.address)

            // only owner can set protocol address
            await expect(pool.connect(user1).setFeeReceipient(user1.address)).to.be.revertedWith("OnlyAdmin")

            // set user1 as protocol account
            await pool.connect(gov).setFeeReceipient(user1.address)

            expect(await pool.feeReceipient()).eq(user1.address)

            await expect(pool.connect(gov).setFeeReceipient(ZERO_ADDRESS)).to.be.revertedWith("ZeroAddress")
        })

        it("setProtocolFee", async () => {
            expect((await pool.subscribeFee()).toNumber()).eq(SUBSCRIBE_FEE)
            expect((await pool.redeemFee()).toNumber()).eq(REDEEM_FEE)

            // only admin can set protocolFee
            await expect(pool.connect(user1).setProtocolFee(20, 20)).to.be.revertedWith("OnlyAdmin")

            // set subscribeFee = 20, redeemFee = 20
            await pool.connect(gov).setProtocolFee(20, 20)

            expect((await pool.subscribeFee()).toNumber()).eq(20)
            expect((await pool.redeemFee()).toNumber()).eq(20)
        })

        it("collectFee", async () => {
            let amount = parseEther("1000")

            // user1 subscribe
            await pool.connect(user1).subscribe(user1.address, amount)

            let claimAmount = parseEther("2")

            // only feeRecipient can collectFee
            await expect(pool.connect(user1).collectFee(claimAmount)).to.be.revertedWith("OnlyReceipient")

            // collect more fee should be reverted
            expect(claimAmount).to.be.gt((await pool.protocolFee()).toBigInt())

            await expect(pool.connect(receipient).collectFee(claimAmount)).to.be.reverted

            claimAmount = parseEther("1")

            let beforeBalance = await usdc.balanceOf(receipient.address)

            expect(claimAmount).to.be.eq((await pool.protocolFee()).toBigInt())

            await pool.connect(receipient).collectFee(claimAmount)

            // protocol account received corresponding amount usdc
            expect(beforeBalance.add(claimAmount).toBigInt()).to.be.eq(
                (await usdc.balanceOf(receipient.address)).toBigInt(),
            )
        })

        it("pause and unpause", async () => {
            expect(await pool.subscriptionPaused()).to.be.eq(false)
            expect(await pool.redemptionPaused()).to.be.eq(false)

            // only minter can pause subscription
            await expect(pool.connect(user1).pauseSubscription()).to.be.revertedWith("OnlyMinter")
            // only burner can pause redemption
            await expect(pool.connect(user1).pauseRedemption()).to.be.revertedWith("OnlyBurner")

            await pool.connect(gov).pauseSubscription()
            await pool.connect(gov).pauseRedemption()

            expect(await pool.subscriptionPaused()).to.be.eq(true)
            expect(await pool.redemptionPaused()).to.be.eq(true)

            // paused status can't subscribe and mintshares
            await expect(pool.connect(user1).subscribe(user1.address, parseEther("10"))).to.be.revertedWith(
                "FeaturePaused",
            )
            await expect(pool.connect(gov).mintShares([user1.address])).to.be.revertedWith("FeaturePaused")
            // paused status can't redeem and burnshares
            await expect(pool.connect(user1).redeem(parseEther("10"))).to.be.revertedWith("FeaturePaused")
            await expect(pool.connect(gov).burnShares([user1.address])).to.be.revertedWith("FeaturePaused")

            // only minter can unpause subscription
            await expect(pool.connect(user1).unpauseSubscription()).to.be.revertedWith("OnlyMinter")
            await pool.connect(gov).unpauseSubscription()
            // only burner can unpause redemption
            await expect(pool.connect(user1).unpauseRedemption()).to.be.revertedWith("OnlyBurner")
            await pool.connect(gov).unpauseRedemption()

            // unpaused status can subscribe
            await pool.connect(user1).subscribe(user1.address, parseEther("1"))

            // unpaused status can redeem
            await pool.connect(user1).redeem(parseEther("10"))
        })

        describe("blocklist", async () => {
            it("not pool admin can't set blocklist", async () => {
                await expect(pool.connect(user1).setBlockList(user1.address)).to.be.revertedWith("OnlyAdmin")
            })

            it("pool admin can set blocklist", async () => {
                expect(await pool.blocklist()).to.be.eq(blocklist.address)
                await pool.connect(gov).setBlockList(user1.address)
                expect(await pool.blocklist()).to.be.eq(user1.address)
            })

            it("owner can add blocklist", async () => {
                await blocklist.connect(gov).addToBlockList([user1.address])
                expect(await blocklist.isBlocked(user1.address)).to.be.eq(true)
            })

            it("not owner can't add blocklist", async () => {
                await expect(blocklist.connect(user1).addToBlockList([user1.address])).to.be.revertedWith(
                    "Ownable: caller is not the owner",
                )
            })

            it("not owner can't remove blocklist", async () => {
                await expect(blocklist.connect(user1).removeFromBlockList([user1.address])).to.be.revertedWith(
                    "Ownable: caller is not the owner",
                )
            })

            it("owner can remove blocklist", async () => {
                await blocklist.connect(gov).removeFromBlockList([user1.address, user2.address])
            })

            it("blocked address can't participate all features", async () => {
                await blocklist.connect(gov).addToBlockList([user1.address])

                await expect(pool.connect(user1).subscribe(user1.address, parseEther("1"))).to.be.revertedWith(
                    "AddressBlocked",
                )

                await expect(pool.connect(user1).redeem(parseEther("1"))).to.be.revertedWith("AddressBlocked")

                await expect(pool.connect(gov).burnShares([user1.address])).to.be.revertedWith("AddressBlocked")

                await expect(pool.connect(gov).mintShares([user1.address])).to.be.revertedWith("AddressBlocked")
            })

            it("remove blcoked user from blocklist, user can continue paritipate feature", async () => {
                await blocklist.connect(gov).addToBlockList([user1.address])

                await expect(pool.connect(user1).subscribe(user1.address, parseEther("1"))).to.be.revertedWith(
                    "AddressBlocked",
                )

                await blocklist.connect(gov).removeFromBlockList([user1.address, user2.address])
                pool.connect(user1).subscribe(user1.address, parseEther("1"))
            })

            it("can set zero address as blocklist", async () => {
                await pool.connect(gov).setBlockList(ZERO_ADDRESS)
                expect(await pool.blocklist()).to.be.eq(ZERO_ADDRESS)
            })

            it("blocked address can participate feature after set blocklist to zero address", async () => {
                await blocklist.connect(gov).addToBlockList([user1.address])

                await expect(pool.connect(user1).subscribe(user1.address, parseEther("1"))).to.be.revertedWith(
                    "AddressBlocked",
                )

                await pool.connect(gov).setBlockList(ZERO_ADDRESS)
                expect(await pool.blocklist()).to.be.eq(ZERO_ADDRESS)
                await pool.connect(gov).setProtocolFee(0, 0)
                await pool.connect(user1).subscribe(user1.address, parseEther("1"))
                expect(await pool.balanceOf(user1.address)).to.be.eq(parseEther("1"))
            })

            it("should be reverted if set not Iblocklist contract as blocklist", async () => {
                await pool.connect(gov).setBlockList(user1.address)
                await expect(pool.connect(user1).subscribe(user1.address, parseEther("1"))).to.be.reverted
            })
        })
    })

    describe("Upgradeability Test", () => {
        let newImpl: MockRWAPool

        beforeEach(async function () {
            const MockRWAPool = await ethers.getContractFactory("MockRWAPool")
            newImpl = (await MockRWAPool.deploy()) as MockRWAPool
        })

        it("Can't upgrade pool by non-owner", async () => {
            expect(factory.connect(user1).upgradePools([pool.address], [newImpl.address])).to.be.revertedWith(
                "Ownable: caller is not the owner",
            )
        })

        it("Can upgrade new pool implementation by factory owner", async () => {
            let uups_slot = await newImpl.proxiableUUID()
            let oldImpl = ethers.utils.hexDataSlice(await ethers.provider.getStorageAt(pool.address, uups_slot), 12, 32)

            await factory.upgradePools([pool.address], [newImpl.address])

            // new implementation should be different with old implementation
            expect(oldImpl).to.not.eq(newImpl.address.toLowerCase())

            // new implementatioin address should be equal pool UUPS proxy slot sotrage value
            expect(
                ethers.utils.hexDataSlice(await ethers.provider.getStorageAt(pool.address, uups_slot), 12, 32),
            ).to.be.eq(newImpl.address.toLowerCase())
        })

        it("stablecoin balance should not change after upgrade", async () => {
            let subscribeAmount = parseEther("1")
            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let user1BalanceBeforeUpgrade = await usdc.balanceOf(user1.address)
            let poolBalanceBeforeUpgrade = await usdc.balanceOf(pool.address)

            await factory.upgradePools([pool.address], [newImpl.address])

            expect(user1BalanceBeforeUpgrade).to.be.eq(await usdc.balanceOf(user1.address))

            expect(poolBalanceBeforeUpgrade).to.be.eq(await usdc.balanceOf(pool.address))
        })

        it("Pool status should not change after upgrade", async () => {
            let subscribeAmount = parseEther("1")
            await pool.connect(user1).subscribe(user1.address, subscribeAmount)

            let user1BalanceBeforeUpgrade = await pool.balanceOf(user1.address)
            let totalSupplyBeforeUpgrade = await pool.totalSupply()
            let bufferedFundBeforeUpgrade = await pool.bufferedFund()
            let protocolFeeBeforeUpgrade = await pool.protocolFee()
            let reserveAccount = await pool.reserve()
            let minimumRedeemInterval = await pool.minimumRedeemInterval()

            await factory.upgradePools([pool.address], [newImpl.address])

            expect(user1BalanceBeforeUpgrade).to.be.eq(await pool.balanceOf(user1.address))
            expect(totalSupplyBeforeUpgrade).to.be.eq(await pool.totalSupply())
            expect(bufferedFundBeforeUpgrade).to.be.eq(await pool.bufferedFund())
            expect(protocolFeeBeforeUpgrade).to.be.eq(await pool.protocolFee())
            expect(reserveAccount).to.be.eq(await pool.reserve())
            expect(minimumRedeemInterval).to.be.eq(await pool.minimumRedeemInterval())
        })

        it("Can withdraw all locked stablecoin after upgrade", async () => {
            await pool.connect(user1).subscribe(user1.address, parseEther("100"))

            expect(pool.connect(user1).withdrawToReserve(parseEther("100"))).to.be.revertedWith("OnlyReserve")

            let bufferedFund = await pool.bufferedFund()
            let beforeBalance = await usdc.balanceOf(reserve.address)

            await factory.upgradePools([pool.address], [newImpl.address])

            await pool.connect(reserve).withdrawToReserve(bufferedFund)

            let afterBalance = await usdc.balanceOf(reserve.address)

            expect(afterBalance).to.be.eq(beforeBalance.add(bufferedFund))
        })

        it("avoid delcare initial state variable for upgradeable contract", async () => {
            await factory.upgradePools([pool.address], [newImpl.address])

            // newPool and pool point to same address, just declare contract type from 'RWAPool' to 'MockRWAPool'
            let newPool = (await ethers.getContractAt("MockRWAPool", await factory.pools(0))) as MockRWAPool

            // non-constant state variables initial value in new implement contract will not be initialized
            expect(await newPool.version()).to.be.eq(0)
            // constant state variables initial value in new implement contract will be hard coded in contract
            expect(await newPool.flag()).to.be.eq(true)
        })
    })
})
