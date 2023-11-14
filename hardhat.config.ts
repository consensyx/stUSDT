import { HardhatUserConfig } from "hardhat/config"
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-etherscan"
import "@nomiclabs/hardhat-waffle"
import "@typechain/hardhat"
import "solidity-coverage"
import "hardhat-gas-reporter"
import "@nomiclabs/hardhat-web3"

import * as dotenv from "dotenv"
dotenv.config({ path: __dirname + "/.env" })
const ALCHEMY_ID = process.env.ALCHEMY_ID
const PK = process.env.PK
const PK_TEST = process.env.PK_TEST
const API_KEY = process.env.API_KEY

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",
    etherscan: {
        apiKey: process.env.ETHERSCAN_API_KEY,
    },
    networks: {
        mainnet: {
            accounts: PK ? [PK] : [],
            chainId: 1,
            url: `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_ID}`,
        },

        goerli: {
            accounts: PK_TEST ? [PK_TEST] : [],
            chainId: 5,
            url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_ID}`,
        },

        bscTestnet: {
            url: "https://data-seed-prebsc-1-s1.binance.org:8545",
            accounts: PK_TEST ? [PK_TEST] : [],
        },

        bscMainnet: {
            url: "https://bsc-dataseed.binance.org",
            accounts: PK_TEST ? [PK_TEST] : [],
        },

        Sepolia: {
            url: "https://rpc.sepolia.org",
            accounts: PK_TEST ? [PK_TEST] : [],
        },
    },

    solidity: {
        compilers: [
            {
                version: "0.8.21",
                settings: {
                    optimizer: { enabled: true, runs: 200 },
                },
            },
        ],
    },

    etherscan: {
        apiKey: API_KEY,
    },
}

export default config
