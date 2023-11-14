// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/**
 * @dev A simple FIFO queues. all operations are O(1) constant time.
 *
 * Refer OpenZeppelin DoubleEndedQueue
 * https://github.com/OpenZeppelin/openzeppelin-contracts/blob/HEAD/contracts/utils/structs/DoubleEndedQueue.sol
 *
 */

library Queue {
    error QueueEmpty();
    error QueueOutOfBounds();

    struct Redeem {
        uint256 amount;
        uint256 timestamp;
    }

    /**
     * @dev Indices are unsigned integers because the queue index will always increase. They are 128 bits so begin and
     * end are packed in a single storage slot for efficient access. Since the items are added one at a time we can
     * safely assume that 128-bit indices will not overflow, and use unchecked arithmetic.
     *
     */
    struct RedeemQueue {
        uint128 _begin;
        uint128 _end;
        mapping(uint128 => Redeem) _data;
    }

    /**
     * @dev Inserts an item at the end of the queue.
     */
    // function pushBack(Uint256Queue storage queue, uint256 value) internal {
    function pushBack(RedeemQueue storage queue, Redeem memory value) internal {
        uint128 backIndex = queue._end;
        queue._data[backIndex] = value;
        queue._end = backIndex + 1;
    }

    /**
     * @dev Removes the item at the beginning of the queue and returns it.
     *
     * Reverts with `QueueEmpty` if the queue is empty.
     */
    function popFront(RedeemQueue storage queue) internal returns (uint256 amount, uint256 timestamp) {
        if (empty(queue)) revert QueueEmpty();
        uint128 frontIndex = queue._begin;
        amount = queue._data[frontIndex].amount;
        timestamp = queue._data[frontIndex].timestamp;
        delete queue._data[frontIndex];
        queue._begin = frontIndex + 1;
    }

    /**
     * @dev Returns the item at the beginning of the queue.
     *
     * Reverts with `QueueEmpty` if the queue is empty.
     */
    function front(RedeemQueue storage queue) internal view returns (uint256, uint256) {
        if (empty(queue)) revert QueueEmpty();
        uint128 frontIndex = queue._begin;
        return (queue._data[frontIndex].amount, queue._data[frontIndex].timestamp);
    }

    /**
     * @dev Returns the item at the end of the queue.
     *
     * Reverts with `QueueEmpty` if the queue is empty.
     */
    function back(RedeemQueue storage queue) internal view returns (uint256, uint256) {
        if (empty(queue)) revert QueueEmpty();
        uint128 backIndex = queue._end - 1;
        return (queue._data[backIndex].amount, queue._data[backIndex].timestamp);
    }

    /** @dev Return the item at a position in the queue given by `index`, with the first item at 0 and last item at
     * `length(queue) - 1`.
     *
     * Reverts with `QueueOutOfBounds` if the index is out of bounds.
     */
    // function at(RedeemQueue storage queue, uint256 index) internal view returns (Redeem memory value) {
    function at(RedeemQueue storage queue, uint256 index) internal view returns (uint256, uint256) {
        if (index > type(uint128).max) revert QueueOutOfBounds();
        uint128 idx = uint128(queue._begin + uint128(index));
        if (idx >= queue._end) revert QueueOutOfBounds();
        return (queue._data[idx].amount, queue._data[idx].timestamp);
    }

    /**
     * @dev Returns the number of items in the queue.
     */
    function length(RedeemQueue storage queue) internal view returns (uint256) {
        // The interface preserves the invariant that begin <= end so we assume this will not overflow.
        // We also assume there are at most int256.max items in the queue.
        unchecked {
            return uint256(queue._end - queue._begin);
        }
    }

    /**
     * @dev Returns true if the queue is empty.
     */
    function empty(RedeemQueue storage queue) internal view returns (bool) {
        return queue._end <= queue._begin;
    }
}
