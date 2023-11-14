// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

interface IBlockList {
    function addToBlockList(address[] calldata accounts) external;

    function removeFromBlockList(address[] calldata accounts) external;

    function isBlocked(address account) external view returns (bool);

    /**
     * @notice Event emitted when addresses are added to the blocklist
     *
     * @param accounts The addresses that were added to the blocklist
     */
    event BlockedAddressesAdded(address[] accounts);

    /**
     * @notice Event emitted when addresses are removed from the blocklist
     *
     * @param accounts The addresses that were removed from the blocklist
     */
    event BlockedAddressesRemoved(address[] accounts);
}
