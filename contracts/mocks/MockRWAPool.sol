// SPDX-License-Identifier: MIT
pragma solidity 0.8.21;

import "../RWAPool.sol";

contract MockRWAPool is RWAPool {
    /**
     * @notice Append State variables
     */

    /// @dev non-constant state variable
    uint8 public version = 1;
    /// @dev constant state variable
    bool public constant flag = true;
}
