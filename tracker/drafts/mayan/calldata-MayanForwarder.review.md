# Draft: MayanForwarder on chain 1

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 1:0x337685fdaB40D39bd02028545a4FfA7D287cC3E2
- Protocol: mayan
- Owner: Mayan, https://mayan.finance
- ABI: sourcify, MayanForwarder2 at 0x337685fdaB40D39bd02028545a4FfA7D287cC3E2
- Descriptor: calldata-MayanForwarder.json; tests: testsv2/calldata-MayanForwarder.tests.json (3)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xfa74fd43 swapAndForwardEth: 443 senders, 553 calls, 57.8% of senders.
- 0x30dedc57 swapAndForwardERC20: 194 senders, 241 calls, 25.3% of senders.
- 0xe4269fc4 forwardERC20: 128 senders, 204 calls, 16.7% of senders.
- The draft describes 3 function(s): 99.9% of the sample's 766 senders per function called.

- `swapAndForwardEth(uint256 amountIn,address swapProtocol,bytes swapData,address middleToken,uint256 minMiddleAmount,address mayanProtocol,bytes mayanData)`: Swap ("Swap {amountIn}")
- `swapAndForwardERC20(address tokenIn,uint256 amountIn,(uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s) permitParams,address swapProtocol,bytes swapData,address middleToken,uint256 minMiddleAmount,address mayanProtocol,bytes mayanData)`: Swap ("Swap {amountIn}")
- `forwardERC20(address tokenIn,uint256 amountIn,(uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s) permitParams,address mayanProtocol,bytes protocolData)`: Forward ERC20

## Review notes

- swapAndForwardEth (0xfa74fd43): swapData looks like call data, but no parameter names the contract it calls: it is shown raw.
- swapAndForwardEth (0xfa74fd43): mayanData looks like call data, but no parameter names the contract it calls: it is shown raw.
- swapAndForwardEth (0xfa74fd43): middleToken is hidden: the amount counted in it shows its symbol.
- swapAndForwardERC20 (0x30dedc57): permitParams.value looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- swapAndForwardERC20 (0x30dedc57): permitParams.v is hidden: a signature is not for reading.
- swapAndForwardERC20 (0x30dedc57): permitParams.r is hidden: a signature is not for reading.
- swapAndForwardERC20 (0x30dedc57): permitParams.s is hidden: a signature is not for reading.
- swapAndForwardERC20 (0x30dedc57): swapData looks like call data, but no parameter names the contract it calls: it is shown raw.
- swapAndForwardERC20 (0x30dedc57): mayanData looks like call data, but no parameter names the contract it calls: it is shown raw.
- swapAndForwardERC20 (0x30dedc57): tokenIn is hidden: the amount counted in it shows its symbol.
- swapAndForwardERC20 (0x30dedc57): middleToken is hidden: the amount counted in it shows its symbol.
- swapAndForwardERC20 (0x30dedc57): minMiddleAmount is counted in the native currency when middleToken is 0x0000000000000000000000000000000000000000, as the samples send it; check that the contract reads it so.
- forwardERC20 (0xe4269fc4): permitParams.v is hidden: a signature is not for reading.
- forwardERC20 (0xe4269fc4): permitParams.r is hidden: a signature is not for reading.
- forwardERC20 (0xe4269fc4): permitParams.s is hidden: a signature is not for reading.
- forwardERC20 (0xe4269fc4): protocolData looks like call data, but no parameter names the contract it calls: it is shown raw.
- forwardERC20 (0xe4269fc4): tokenIn is hidden: the amount counted in it shows its symbol.
