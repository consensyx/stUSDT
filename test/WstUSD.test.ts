import { ethers } from "hardhat"
import { expect } from "chai"
import { time } from "@openzeppelin/test-helpers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address"
import { parseEther, isTDay } from "./utils/common"
import { RWAFactory, RWAPool, WstUSD, MockERC20 } from "../typechain"

describe("WstUSD Test", () => {
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
    let wstUSD: WstUSD

    const name = "stUSDT"
    const symbol = "stUSDT"
    const DAY_SECONDS = 86400

    beforeEach(async () => {
        ;[gov, rebaseAdmin, reserve, receipient, user1, user2, user3] = await ethers.getSigners()

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

        await stUSD.connect(gov).setProtocolFee(0, 0)
        await stUSD.connect(gov).setRebaseRateLimit(5000, 5000)
        await stUSD.connect(gov).setMaximumTotalStakingLimit(parseEther("1000000000"))

        // await usdc.mint(gov.address, parseEther("100000"));
        await usdc.mint(user1.address, parseEther("100"))
        await usdc.connect(user1).approve(stUSD.address, parseEther("100"))

        let latestTime = (await time.latest()).toNumber()
        if (!isTDay(latestTime)) {
            await time.increaseTo(Math.floor(latestTime / DAY_SECONDS) * DAY_SECONDS + DAY_SECONDS)
        }
        latestTime = (await time.latest()).toNumber()
        expect(isTDay(latestTime)).to.be.eq(true)
        // user1 subscribe 100 to stUSD pool
        await stUSD.connect(user1).subscribe(user1.address, parseEther("100"))

        // Setup WstUSD
        const WstUSD = await ethers.getContractFactory("WstUSD")
        wstUSD = await WstUSD.deploy(stUSD.address)
    })

    describe(`Wrapping / Unwrapping`, function () {
        beforeEach(async function () {
            await stUSD.connect(user1).approve(wstUSD.address, parseEther("50"))
            expect(await stUSD.allowance(user1.address, wstUSD.address)).to.be.eq(parseEther("50"))
        })

        it(`initial balances are correct`, async function () {
            expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("100"))
            expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("0"))
            expect(await stUSD.balanceOf(user2.address)).to.be.eq(parseEther("0"))
            expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(parseEther("0"))
        })

        it(`StUSD is set correctly`, async function () {
            expect(await wstUSD.stUSD()).to.be.eq(stUSD.address)
        })

        it(`can't wrap zero amount`, async function () {
            await expect(wstUSD.connect(user1).wrap(0)).to.be.revertedWith("WrapZero")
        })

        it(`can't wrap more than allowed`, async function () {
            await expect(wstUSD.connect(user1).wrap(parseEther("51"))).to.be.revertedWith(
                "ERC20: insufficient allowance",
            )
        })

        it(`cant wrap if sender hasn't any stUSD`, async function () {
            await stUSD.connect(user2).approve(wstUSD.address, parseEther("50"))
            await expect(wstUSD.connect(user2).wrap(parseEther("1"))).to.be.revertedWith("ExceedBalance")
        })

        describe(`After successful wrap`, function () {
            beforeEach(async function () {
                await wstUSD.connect(user1).wrap(parseEther("50"))
                expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))

                await wstUSD.connect(user1).approve(user3.address, parseEther("25"))
                expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
            })

            it(`balances are correct`, async function () {
                expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                expect(await stUSD.balanceOf(user2.address)).to.be.eq(parseEther("0"))
                expect(await wstUSD.balanceOf(user2.address)).to.be.eq(parseEther("0"))
                expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(parseEther("50"))
            })

            it(`can't unwrap zero amount`, async function () {
                await expect(wstUSD.connect(user1).unwrap(0)).to.be.revertedWith("UnwrapZero")
            })

            it(`user can't unwrap more wstUSD than the balance`, async function () {
                await expect(wstUSD.connect(user1).unwrap(parseEther("51"))).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance",
                )
            })

            it(`can't unwrap if sender hasn't any wstUSD`, async function () {
                await expect(wstUSD.connect(user2).unwrap(parseEther("1"))).to.be.revertedWith(
                    "ERC20: burn amount exceeds balance",
                )
            })

            describe(`Before rewarding/slashing`, function () {
                it(`after partial unwrap balances are correct`, async function () {
                    for (let i = 0; i < 5; i++) await wstUSD.connect(user1).unwrap(parseEther("10"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("100"))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`after full unwrap balances are correct`, async function () {
                    const user1BeforeBalance = await stUSD.balanceOf(user1.address)
                    await wstUSD.connect(user1).unwrap(parseEther("50"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(user1BeforeBalance.add(parseEther("50")))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`wstUSD allowances isn't changed`, async function () {
                    expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
                })

                describe(`After user2 submission`, function () {
                    beforeEach(async function () {
                        await usdc.mint(user2.address, parseEther("100"))
                        await usdc.connect(user2).approve(stUSD.address, parseEther("100"))
                        await stUSD.connect(user2).subscribe(user2.address, parseEther("100"))

                        await stUSD.connect(user2).approve(wstUSD.address, parseEther("50"))
                        expect(await stUSD.allowance(user2.address, wstUSD.address)).to.be.equal(parseEther("50"))
                    })

                    it(`balances are correct`, async function () {
                        expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                        expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                        expect(await stUSD.balanceOf(user2.address)).to.be.eq(parseEther("100"))
                        expect(await wstUSD.balanceOf(user2.address)).to.be.eq(parseEther("0"))
                        expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(parseEther("50"))
                    })

                    describe(`After successful wrap`, function () {
                        beforeEach(async function () {
                            await wstUSD.connect(user2).wrap(parseEther("50"))
                        })

                        it(`balances are correct`, async function () {
                            expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                            expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.eq(parseEther("50"))
                            expect(await wstUSD.balanceOf(user2.address)).to.be.eq(parseEther("50"))
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(parseEther("100"))
                        })
                    })
                })
            })

            describe(`After rewarding`, function () {
                beforeEach(async function () {
                    // get 10 ether rewarding after rebase
                    let beforeTotalSupply = await stUSD.totalSupply()
                    await stUSD.connect(reserve).withdrawToReserve(parseEther("50"))
                    // add 10 ether reward
                    await stUSD.connect(rebaseAdmin).rebase(parseEther("60"))
                    expect(await stUSD.totalSupply()).to.be.eq(beforeTotalSupply.add(parseEther("10")))
                })

                it(`after partial unwrap balances are correct`, async function () {
                    for (let i = 0; i < 5; i++) await wstUSD.connect(user1).unwrap(parseEther("10"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("110"))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`after full unwrap balances are correct`, async function () {
                    await wstUSD.connect(user1).unwrap(parseEther("50"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("110"))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.equal(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`wstUSD allowances isn't changed`, async function () {
                    expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
                })

                describe(`After user2 submission`, function () {
                    beforeEach(async function () {
                        await usdc.mint(user2.address, parseEther("100"))
                        await usdc.connect(user2).approve(stUSD.address, parseEther("100"))
                        await stUSD.connect(user2).subscribe(user2.address, parseEther("100"))

                        await stUSD.connect(user2).approve(wstUSD.address, parseEther("50"))
                    })

                    it(`balances are correct`, async function () {
                        expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("55"))
                        expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("50"))
                        expect(await stUSD.balanceOf(user2.address)).to.be.gt(parseEther("99.999"))
                        expect(await stUSD.balanceOf(user2.address)).to.be.lt(parseEther("100")) // round

                        expect(await wstUSD.balanceOf(user2.address)).to.be.eq(0)
                        expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(parseEther("55"))
                    })

                    it(`wstUSD allowances isn't changed`, async function () {
                        expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
                    })

                    describe(`After user2 wrap`, function () {
                        beforeEach(async function () {
                            await wstUSD.connect(user2).wrap(parseEther("50"))
                        })

                        it(`balances are correct`, async function () {
                            expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("55"))
                            expect(await wstUSD.balanceOf(user1.address)).to.be.equal(parseEther("50"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.gt(parseEther("49.999"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.lt(parseEther("50")) // round
                            expect(await wstUSD.balanceOf(user2.address)).to.be.gt(parseEther("45.45"))
                            expect(await wstUSD.balanceOf(user2.address)).to.be.lt(parseEther("45.5")) // round
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.equal(parseEther("105"))
                        })

                        it(`after partial unwrap balances are correct`, async function () {
                            for (let i = 0; i < 5; i++) {
                                await wstUSD.connect(user1).unwrap(parseEther("10"))
                                await wstUSD.connect(user2).unwrap(parseEther("9"))
                            }

                            expect(await stUSD.balanceOf(user1.address)).to.be.lt(parseEther("110"))
                            expect(await stUSD.balanceOf(user1.address)).to.be.gt(parseEther("109.999"))
                            expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("0"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.lt(parseEther("100"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.gt(parseEther("99"))
                            expect(await wstUSD.balanceOf(user2.address)).to.be.gt(parseEther("0"))
                            expect(await wstUSD.balanceOf(user2.address)).to.be.lt(parseEther("0.5"))
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.gt(parseEther("0.5"))
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.lt(parseEther("0.51"))
                        })

                        it(`after full unwrap balances are correct`, async function () {
                            await wstUSD.connect(user1).unwrap(parseEther("50"))
                            await wstUSD.connect(user2).unwrap(await wstUSD.balanceOf(user2.address))

                            expect(await stUSD.balanceOf(user1.address)).to.be.lt(parseEther("110"))
                            expect(await stUSD.balanceOf(user1.address)).to.be.gt(parseEther("109.999"))
                            expect(await wstUSD.balanceOf(user1.address)).to.be.eq(parseEther("0"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.gt(parseEther("99.9999"))
                            expect(await stUSD.balanceOf(user2.address)).to.be.lt(parseEther("100"))
                            expect(await wstUSD.balanceOf(user2.address)).to.be.eq(parseEther("0"))
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.lt(parseEther("0.001"))
                            expect(await stUSD.balanceOf(wstUSD.address)).to.be.gt(parseEther("0"))
                        })

                        it(`wstUSD allowances isn't changed`, async function () {
                            expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
                        })
                    })
                })
            })

            describe(`After get loss`, function () {
                beforeEach(async function () {
                    let beforeTotalSupply = await stUSD.totalSupply()
                    await stUSD.connect(reserve).withdrawToReserve(parseEther("50"))
                    // deduct 10 ether reward
                    await stUSD.connect(rebaseAdmin).rebase(parseEther("40"))
                    expect(await stUSD.totalSupply()).to.be.eq(beforeTotalSupply.sub(parseEther("10")))
                })

                it(`after partial unwrap balances are correct`, async function () {
                    for (let i = 0; i < 5; i++) await wstUSD.connect(user1).unwrap(parseEther("10"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("90"))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`after full unwrap balances are correct`, async function () {
                    await wstUSD.connect(user1).unwrap(parseEther("50"))

                    expect(await stUSD.balanceOf(user1.address)).to.be.eq(parseEther("90"))
                    expect(await stUSD.balanceOf(wstUSD.address)).to.be.eq(0)
                    expect(await wstUSD.balanceOf(user1.address)).to.be.eq(0)
                })

                it(`wstUSD allowances aren't changed`, async function () {
                    expect(await wstUSD.allowance(user1.address, user3.address)).to.be.eq(parseEther("25"))
                })
            })

            describe(`wstUSD and stUSD convertions`, function () {
                it(`has method for getting stUSD by wstUSD amount`, async function () {
                    expect(await wstUSD.getStUSDByWstUSD("1")).to.be.least("1")
                })
                it(`has method for getting wstUSD by stUSD amount`, async function () {
                    expect(await wstUSD.getWstUSDByStUSD("1")).to.be.most("1")
                })
                it(`has method for getting stUSD by 1 wstUSD`, async function () {
                    expect(await wstUSD.stUSDPerToken()).to.be.least(parseEther("1"))
                })
                it(`has method for getting wstUSD by 1 stUSD`, async function () {
                    expect(await wstUSD.tokensPerStUSD()).to.be.most(parseEther("1"))
                })
            })
        })
    })
})
