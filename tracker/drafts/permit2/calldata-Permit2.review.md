# Draft: Permit2 on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x000000000022D473030F116dDEE9F6B43aC78BA3
- Protocol: permit2
- Owner: Permit2 (Uniswap), https://github.com/Uniswap/permit2
- ABI: sourcify, Permit2 at 0x000000000022D473030F116dDEE9F6B43aC78BA3
- Descriptor: calldata-Permit2.json; tests: testsv2/calldata-Permit2.tests.json (7)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0x87517c45 approve: 161 senders, 958 calls, 94.2% of senders.
- 0x0d58b1db transferFrom: 2 senders, 12 calls, 1.2% of senders.
- Skipped 0x2b67b570 (2 senders, 6 calls, 1.2% of senders): not a function of the ABI.
- 0xcc53287f lockdown: 2 senders, 2 calls, 1.2% of senders.
- 0x30f28b7a permitTransferFrom: 1 senders, 14 calls, 0.6% of senders.
- 0x36c78516 transferFrom: 1 senders, 6 calls, 0.6% of senders.
- 0x137c29fe permitWitnessTransferFrom: 1 senders, 1 calls, 0.6% of senders.
- 0xedd9444b permitTransferFrom: 1 senders, 1 calls, 0.6% of senders.
- The draft describes 7 function(s): 98.8% of the sample's 171 senders per function called.

- `approve(address token,address spender,uint160 amount,uint48 expiration)`: Approve ("Approve {spender} to spend {amount}")
- `transferFrom((address from,address to,uint160 amount,address token)[] transferDetails)`: Transfer
- `lockdown((address token,address spender)[] approvals)`: Lockdown
- `permitTransferFrom(((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount) transferDetails,address owner,bytes signature)`: Permit transfer from
- `transferFrom(address from,address to,uint160 amount,address token)`: Transfer ("Transfer {amount} to {to}")
- `permitWitnessTransferFrom(((address token,uint256 amount) permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount) transferDetails,address owner,bytes32 witness,string witnessTypeString,bytes signature)`: Permit witness transfer from
- `permitTransferFrom(((address token,uint256 amount)[] permitted,uint256 nonce,uint256 deadline) permit,(address to,uint256 requestedAmount)[] transferDetails,address owner,bytes signature)`: Permit transfer from

## Review notes

- approve (0x87517c45): token is hidden: the amount counted in it shows its symbol.
- transferFrom (0x0d58b1db): transferDetails.[].token is hidden: the amount counted in it shows its symbol.
- permitTransferFrom (0x30f28b7a): transferDetails.requestedAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- permitTransferFrom (0x30f28b7a): signature is hidden: a signature is not for reading.
- permitTransferFrom (0x30f28b7a): permit.permitted.token is hidden: the amount counted in it shows its symbol.
- transferFrom (0x36c78516): token is hidden: the amount counted in it shows its symbol.
- permitWitnessTransferFrom (0x137c29fe): transferDetails.requestedAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- permitWitnessTransferFrom (0x137c29fe): witnessTypeString (string) is shown raw.
- permitWitnessTransferFrom (0x137c29fe): signature is hidden: a signature is not for reading.
- permitWitnessTransferFrom (0x137c29fe): permit.permitted.token is hidden: the amount counted in it shows its symbol.
- permitTransferFrom (0xedd9444b): transferDetails.[].requestedAmount looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- permitTransferFrom (0xedd9444b): signature is hidden: a signature is not for reading.
- permitTransferFrom (0xedd9444b): permit.permitted.[].token is hidden: the amount counted in it shows its symbol.
