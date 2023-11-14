//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

import "./interfaces/IStUSD.sol";

/**
 * @title Wrapper for stUSDT tokens with static balances.
 * @dev stUSDT is a rebasing token, that means token balance maybe changed after daily rebase.
 *
 * Some of Defi protocol not support rebasing token, so we provide this 'wraper' for anyone want to
 * get non-rebasing token and provide liquidity to Uniswap like AMM pools

 * It is a trustless wrapper, accepting StUSD tokens and generating WstUSD in response. when the user
 * decides to unwrap, the contract burn the user's WstUSD, subsequently releasing locked WstUSD back to the user.
 *
 * WstUSD token balance represents the account's share of StUSD tokens, it only changes on transfers.
 *
 */

contract WstUSD is ERC20Permit {
    IStUSD public stUSD;

    error WrapZero();
    error UnwrapZero();

    constructor(IStUSD _stUSD) ERC20Permit("Wrapped staked USD") ERC20("Wrapped staked USD", "wstUSD") {
        stUSD = _stUSD;
    }

    // ================== Wrap Helper ================== //

    /// @notice Exchange stUSD to wstUSD
    function wrap(uint256 _stUSDAmount) external returns (uint256) {
        if (_stUSDAmount <= 0) revert WrapZero();

        uint256 wstUSDAmount = stUSD.getSharesByUnderlying(_stUSDAmount);
        _mint(msg.sender, wstUSDAmount);
        stUSD.transferFrom(msg.sender, address(this), _stUSDAmount);
        return wstUSDAmount;
    }

    /// @notice Exchange wstUSD to stUSD
    function unwrap(uint256 _wstUSDAmount) external returns (uint256) {
        if (_wstUSDAmount <= 0) revert UnwrapZero();

        uint256 stUSDAmount = stUSD.getUnderlyingByShares(_wstUSDAmount);
        _burn(msg.sender, _wstUSDAmount);
        stUSD.transfer(msg.sender, stUSDAmount);
        return stUSDAmount;
    }

    // ================== Exchange Rate Helper ==================  //

    /// @notice Get amount of wstUSD for a specific amount of stUSD
    function getWstUSDByStUSD(uint256 _stUSDAmount) external view returns (uint256) {
        return stUSD.getSharesByUnderlying(_stUSDAmount);
    }

    /// @notice Get stUSD amount for a specific amount of wstUSD
    function getStUSDByWstUSD(uint256 _wstUSDAmount) external view returns (uint256) {
        return stUSD.getUnderlyingByShares(_wstUSDAmount);
    }

    /// @notice Get stUSD amount for 1 wstUSD
    function stUSDPerToken() external view returns (uint256) {
        return stUSD.getUnderlyingByShares(1 ether);
    }

    /// @notice Get wstUSD amount for 1 stUSD
    function tokensPerStUSD() external view returns (uint256) {
        return stUSD.getSharesByUnderlying(1 ether);
    }
}
