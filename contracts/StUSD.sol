// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";

import "./utils/Errors.sol";
import "./interfaces/IStUSD.sol";

/// @title Rebase ERC20 token
abstract contract StUSD is IStUSD, ERC20PermitUpgradeable {
    /**
     * @dev StUSD balances are dynamic and are determined by the proportional
     * ownership of accounts and the total amount of USD pegged by the protocol.
     * the contract stores the sum of all shares to calculate each account's
     * token balance which equals to:
     *
     *   shares[account] * _getTotalUnderlying() / totalShares
     */
    mapping(address => uint256) public shares;

    uint256 public totalShares;

    function totalSupply() public view override(IERC20Upgradeable, ERC20Upgradeable) returns (uint256) {
        return _getTotalUnderlying();
    }

    function balanceOf(address _account) public view override(IERC20Upgradeable, ERC20Upgradeable) returns (uint256) {
        return getUnderlyingByShares(shares[_account]);
    }

    function transferShares(address _recipient, uint256 _sharesAmount) public returns (uint256) {
        _transferShares(msg.sender, _recipient, _sharesAmount);
        emit TransferShares(msg.sender, _recipient, _sharesAmount);
        uint256 tokensAmount = getUnderlyingByShares(_sharesAmount);
        emit Transfer(msg.sender, _recipient, tokensAmount);
        return tokensAmount;
    }

    function sharesOf(address _account) public view returns (uint256) {
        return shares[_account];
    }

    function getSharesByUnderlying(uint256 _usd) public view returns (uint256) {
        uint256 totalUnderlying = _getTotalUnderlying();
        if (totalUnderlying == 0) {
            return 0;
        } else {
            return (_usd * totalShares) / totalUnderlying;
        }
    }

    function getUnderlyingByShares(uint256 _sharesAmount) public view returns (uint256) {
        if (totalShares == 0) {
            return 0;
        } else {
            return (_sharesAmount * _getTotalUnderlying()) / totalShares;
        }
    }

    function _getTotalUnderlying() internal view virtual returns (uint256);

    function _transfer(address _sender, address _recipient, uint256 _amount) internal override {
        uint256 _sharesToTransfer = getSharesByUnderlying(_amount);
        _transferShares(_sender, _recipient, _sharesToTransfer);
        emit Transfer(_sender, _recipient, _amount);
        emit TransferShares(_sender, _recipient, _sharesToTransfer);
    }

    function _sharesOf(address _account) internal view returns (uint256) {
        return shares[_account];
    }

    function _transferShares(address _sender, address _recipient, uint256 _sharesAmount) internal virtual;

    function _mintShares(address _recipient, uint256 _sharesAmount) internal {
        if (_recipient == address(0)) revert Errors.ZeroAddress();

        shares[_recipient] = shares[_recipient] + _sharesAmount;
        totalShares = totalShares + _sharesAmount;
    }

    function _burnShares(address _account, uint256 _sharesAmount) internal {
        if (_account == address(0)) revert Errors.ZeroAddress();

        uint256 accountShares = shares[_account];
        if (_sharesAmount > accountShares) revert ExceedBalance();

        uint256 preRebaseTokenAmount = getUnderlyingByShares(_sharesAmount);

        shares[_account] = accountShares - _sharesAmount;
        totalShares = totalShares - _sharesAmount;

        uint256 postRebaseTokenAmount = getUnderlyingByShares(_sharesAmount);

        emit BurnShares(_account, preRebaseTokenAmount, postRebaseTokenAmount, _sharesAmount);
    }
}
