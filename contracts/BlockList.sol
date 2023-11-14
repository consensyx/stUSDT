// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

import "./interfaces/IBlockList.sol";

contract BlockList is Ownable2Step, IBlockList {
    mapping(address => bool) private blockedAddresses;

    /**
     * @notice Add a list of accounts to the blocklist
     *
     * @param accounts Array of addresses to block
     */
    function addToBlockList(address[] calldata accounts) external onlyOwner {
        for (uint256 i; i < accounts.length; ) {
            blockedAddresses[accounts[i]] = true;

            unchecked {
                ++i;
            }
        }
        emit BlockedAddressesAdded(accounts);
    }

    /**
     * @notice Remove a list of accounts from the blocklist
     *
     * @param accounts Array of addresses to unblock
     */
    function removeFromBlockList(address[] calldata accounts) external onlyOwner {
        for (uint256 i; i < accounts.length; ) {
            blockedAddresses[accounts[i]] = false;

            unchecked {
                ++i;
            }
        }
        emit BlockedAddressesRemoved(accounts);
    }

    /**
     * @notice Check if an account is blocked
     *
     * @param addr Address to check
     *
     * @return True if account is blocked, false otherwise
     */
    function isBlocked(address addr) external view returns (bool) {
        return blockedAddresses[addr];
    }
}
