# Draft: aeWETH on chain 42161

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 42161:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
- Protocol: weth
- Owner: Wrapped Ether (WETH), https://weth.io
- ABI: sourcify, aeWETH at 0x8b194bEae1d3e0788A1a35173978001ACDFba668
- Descriptor: calldata-aeWETH.json; tests: testsv2/calldata-aeWETH.tests.json (4)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x095ea7b3 approve: 124 senders, 148 calls, 35.3% of senders.
- 0xa9059cbb transfer: 103 senders, 149 calls, 29.3% of senders.
- 0x2e1a7d4d withdraw: 81 senders, 383 calls, 23.1% of senders.
- 0xd0e30db0 deposit: 43 senders, 320 calls, 12.3% of senders.
- The draft describes 4 function(s): 100.0% of the sample's 351 senders per function called.

- `approve(address spender,uint256 amount)`: Approve ("Approve {spender} to spend {amount}")
- `transfer(address recipient,uint256 amount)`: Transfer ("Transfer {amount} to {recipient}")
- `withdraw(uint256 amount)`: Withdraw ("Withdraw {amount}")
- `deposit()`: Deposit ("Deposit {@.value}")

## Review notes

- approve (0x095ea7b3): amount has no token parameter, so it is counted in the contract's own token (@.to).
- transfer (0xa9059cbb): amount has no token parameter, so it is counted in the contract's own token (@.to).
- withdraw (0x2e1a7d4d): amount has no token parameter, so it is counted in the contract's own token (@.to).
