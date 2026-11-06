# Draft: WETH9 on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x4200000000000000000000000000000000000006
- Protocol: weth
- Owner: Wrapped Ether (WETH), https://weth.io
- ABI: sourcify, WETH9 at 0x4200000000000000000000000000000000000006
- Descriptor: calldata-WETH9.json; tests: testsv2/calldata-WETH9.tests.json (4)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x095ea7b3 approve: 244 senders, 516 calls, 65.2% of senders.
- 0x2e1a7d4d withdraw: 75 senders, 412 calls, 20.1% of senders.
- 0xd0e30db0 deposit: 40 senders, 54 calls, 10.7% of senders.
- 0xa9059cbb transfer: 15 senders, 18 calls, 4.0% of senders.
- The draft describes 4 function(s): 100.0% of the sample's 374 senders per function called.

- `approve(address guy,uint256 wad)`: Approve ("Approve {wad}")
- `withdraw(uint256 wad)`: Withdraw ("Withdraw {wad}")
- `deposit()`: Deposit ("Deposit {@.value}")
- `transfer(address dst,uint256 wad)`: Transfer ("Transfer {wad}")

## Review notes

- approve (0x095ea7b3): wad has no token parameter, so it is counted in the contract's own token (@.to).
- withdraw (0x2e1a7d4d): wad has no token parameter, so it is counted in the contract's own token (@.to).
- transfer (0xa9059cbb): wad has no token parameter, so it is counted in the contract's own token (@.to).
