# Draft: NonfungiblePositionManager on chain 8453

Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.

- Deployment: 8453:0x827922686190790b37229fd06084350E74485b72
- Protocol: aerodrome
- Owner: Aerodrome (legacy, now Aero), https://aerodrome.finance
- ABI: sourcify, NonfungiblePositionManager at 0x827922686190790b37229fd06084350E74485b72
- Descriptor: calldata-NonfungiblePositionManager.json; tests: testsv2/calldata-NonfungiblePositionManager.tests.json (8)
- Chain names: chains_mini.json (sha256 bdbf26a2b30bf7315af3b85711367d90a5d997197e1e7e980f1c32423d34f491)
- Tests rendered against: the registry at ef582c2f03bfbd062b7e3889b55dd3b45c3d5494

## Functions

- 0xac9650d8 multicall: 60 senders, 84 calls, 41.7% of senders.
- 0xb88d4fde safeTransferFrom: 26 senders, 30 calls, 18.1% of senders.
- 0xb5007d1f mint: 18 senders, 28 calls, 12.5% of senders.
- 0x095ea7b3 approve: 18 senders, 25 calls, 12.5% of senders.
- 0xfc6f7865 collect: 10 senders, 103 calls, 6.9% of senders.
- 0x219f5d17 increaseLiquidity: 6 senders, 10 calls, 4.2% of senders.
- 0xa22cb465 setApprovalForAll: 3 senders, 3 calls, 2.1% of senders.
- 0x0c49ccbe decreaseLiquidity: 2 senders, 2 calls, 1.4% of senders.
- The draft describes 8 function(s): 99.3% of the sample's 144 senders per function called.

- `multicall(bytes[] data)`: Multicall
- `safeTransferFrom(address from,address to,uint256 tokenId,bytes _data)`: Safe transfer from
- `mint((address token0,address token1,int24 tickSpacing,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline,uint160 sqrtPriceX96) params)`: Mint ("Mint {params.amount0Desired}")
- `approve(address to,uint256 tokenId)`: Approve
- `collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params)`: Collect
- `increaseLiquidity((uint256 tokenId,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params)`: Add liquidity ("Add up to {@.value} as liquidity")
- `setApprovalForAll(address operator,bool approved)`: Set approval for all
- `decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params)`: Remove liquidity

## Review notes

- multicall (0xac9650d8): data.[] is a call to @.to: a wallet shows it through that contract's descriptor.
- safeTransferFrom (0xb88d4fde): _data looks like call data, but no parameter names the contract it calls: it is shown raw.
- mint (0xb5007d1f): params.token0 is hidden: the amount counted in it shows its symbol.
- mint (0xb5007d1f): params.token1 is hidden: the amount counted in it shows its symbol.
- collect (0xfc6f7865): params.amount0Max looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- collect (0xfc6f7865): params.amount1Max looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- increaseLiquidity (0x219f5d17): params.amount0Desired looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- increaseLiquidity (0x219f5d17): params.amount1Desired looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- increaseLiquidity (0x219f5d17): params.amount0Min looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- increaseLiquidity (0x219f5d17): params.amount1Min looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- decreaseLiquidity (0x0c49ccbe): params.liquidity looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- decreaseLiquidity (0x0c49ccbe): params.amount0Min looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
- decreaseLiquidity (0x0c49ccbe): params.amount1Min looks like an amount, but no token parameter goes with it: it is shown raw, in base units.
