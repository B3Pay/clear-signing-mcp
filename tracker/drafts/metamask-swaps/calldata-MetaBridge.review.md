# Draft: MetaBridge on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x0439e60F02a8900a951603950d8D4527f400C3f1
- Protocol: metamask-swaps
- Owner: MetaMask Swaps & Bridge, https://metamask.io
- ABI: sourcify, MetaBridge at 0x0439e60F02a8900a951603950d8D4527f400C3f1
- Descriptor: calldata-MetaBridge.json; tests: testsv2/calldata-MetaBridge.tests.json (1)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x3ce33bff bridge: 799 senders, 1000 calls, 100.0% of senders.
- The draft describes 1 function(s): 100.0% of the sample's 799 senders per function called.

- `bridge(string adapterId,address srcToken,uint256 amount,bytes data)`: Bridge ("Bridge {amount}")

## Review notes

- bridge (0x3ce33bff): adapterId (string) is shown raw.
- bridge (0x3ce33bff): data looks like call data, but no parameter names the contract it calls: it is shown raw.
- bridge (0x3ce33bff): srcToken is hidden: the amount counted in it shows its symbol.
- bridge (0x3ce33bff): amount is counted in the native currency when srcToken is 0x0000000000000000000000000000000000000000, as the samples send it; check that the contract reads it so.
