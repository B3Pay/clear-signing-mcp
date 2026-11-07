# Draft: MetaSwap on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x881D40237659C251811CEC9c364ef91dC08D300C
- Protocol: metamask-swaps
- Owner: MetaMask Swaps & Bridge, https://metamask.io
- ABI: sourcify, MetaSwap at 0x881D40237659C251811CEC9c364ef91dC08D300C
- Descriptor: calldata-MetaSwap.json; tests: testsv2/calldata-MetaSwap.tests.json (1)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x5f575529 swap: 777 senders, 1000 calls, 100.0% of senders.
- The draft describes 1 function(s): 100.0% of the sample's 777 senders per function called.

- `swap(string aggregatorId,address tokenFrom,uint256 amount,bytes data)`: Swap ("Swap {amount}")

## Review notes

- swap (0x5f575529): aggregatorId (string) is shown raw.
- swap (0x5f575529): data looks like call data, but no parameter names the contract it calls: it is shown raw.
- swap (0x5f575529): tokenFrom is hidden: the amount counted in it shows its symbol.
- swap (0x5f575529): amount is counted in the native currency when tokenFrom is 0x0000000000000000000000000000000000000000, as the samples send it; check that the contract reads it so.
