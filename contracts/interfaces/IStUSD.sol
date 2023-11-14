//SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20PermitUpgradeable.sol";

/// @dev StUSD token interface
interface IStUSD is IERC20Upgradeable, IERC20PermitUpgradeable {
    error ExceedBalance();
    error ExceedAllowance();
    error TransferSelfContract();

    event MintShares(address indexed account, uint256 shares, uint256 amount);
    event TransferShares(address indexed from, address indexed to, uint256 sharesValue);
    event BurnShares(
        address indexed account,
        uint256 preRebaseTokenAmount,
        uint256 postRebaseTokenAmount,
        uint256 shares
    );

    function transferShares(address recipient, uint256 sharesAmount) external returns (uint256);

    function sharesOf(address account) external view returns (uint256);

    function getSharesByUnderlying(uint256 usd) external view returns (uint256);

    function getUnderlyingByShares(uint256 sharesAmount) external view returns (uint256);

    function totalShares() external view returns (uint256);
}
