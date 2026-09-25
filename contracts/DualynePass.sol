// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @title Dualyne Pass
/// @notice A wallet holding at least one Pass gets Dualyne Pro (every model in Chat, Pro daily
///         limits) for as long as it holds it. The website reads balanceOf() at sign-in and every
///         few minutes after; nothing else about the token matters to the app.
///
///         Adapted from nekara's ProofKeys: same mint rules (fixed supply, price, per-wallet cap,
///         owner reserve, withdraw), without tiers or a reveal, since every Pass gives the same
///         access. The artwork is drawn on-chain; packages/shared/src/pass.ts draws the same SVG
///         for the website and a test checks the two match.
///
///         Marketplaces read contractURI() for the collection page and royaltyInfo() (ERC-2981)
///         for the creator fee on resales.
contract DualynePass is ERC721, ERC2981, Ownable, ReentrancyGuard {
    using Strings for uint256;

    /* ─────────── supply ─────────── */

    uint256 public immutable maxSupply;
    uint256 public immutable maxPerWallet;
    uint256 public totalMinted;

    /* ─────────── sale ─────────── */

    uint256 public price;
    bool public mintOpen;
    mapping(address => uint256) public mintedBy;

    /* ─────────── events / errors ─────────── */

    event Minted(address indexed to, uint256 indexed firstId, uint256 quantity);
    event MintOpenSet(bool open);
    event PriceSet(uint256 price);
    event RoyaltySet(address receiver, uint96 bps);

    error MintClosed();
    error BadQuantity();
    error SoldOut();
    error WalletLimit();
    error BadPayment();
    error TransferFailed();

    /// @param royaltyBps_ creator fee on resales, in basis points (500 = 5%), paid to owner_
    constructor(uint256 maxSupply_, uint256 maxPerWallet_, uint256 price_, address owner_, uint96 royaltyBps_)
        ERC721("Dualyne Pass", "DPASS")
        Ownable(owner_)
    {
        maxSupply = maxSupply_;
        maxPerWallet = maxPerWallet_;
        price = price_;
        _setDefaultRoyalty(owner_, royaltyBps_);
    }

    /* ─────────── minting ─────────── */

    function mint(uint256 qty) external payable nonReentrant {
        if (!mintOpen) revert MintClosed();
        if (qty == 0) revert BadQuantity();
        if (mintedBy[msg.sender] + qty > maxPerWallet) revert WalletLimit();
        if (msg.value != price * qty) revert BadPayment();
        mintedBy[msg.sender] += qty;
        _mintMany(msg.sender, qty);
    }

    /// @notice Team, partners and giveaways. Counts toward maxSupply; free; ignores the wallet cap.
    function mintReserved(address to, uint256 qty) external onlyOwner nonReentrant {
        if (qty == 0) revert BadQuantity();
        _mintMany(to, qty);
    }

    function _mintMany(address to, uint256 qty) internal {
        if (totalMinted + qty > maxSupply) revert SoldOut();
        uint256 first = totalMinted + 1;
        totalMinted += qty;
        for (uint256 i = 0; i < qty; i++) _safeMint(to, first + i);
        emit Minted(to, first, qty);
    }

    /* ─────────── admin ─────────── */

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenSet(open);
    }

    function setPrice(uint256 p) external onlyOwner {
        price = p;
        emit PriceSet(p);
    }

    /// @notice Marketplaces may or may not honour this; max 10%.
    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        require(bps <= 1000, "royalty over 10%");
        _setDefaultRoyalty(receiver, bps);
        emit RoyaltySet(receiver, bps);
    }

    function withdraw(address payable to) external onlyOwner nonReentrant {
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    /* ─────────── reads ─────────── */

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function supportsInterface(bytes4 id) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }

    /// @notice Collection details for marketplaces (OpenSea and others read this).
    function contractURI() external pure returns (string memory) {
        (, string memory a, string memory b) = _palette(1);
        string memory json = string.concat(
            '{"name":"Dualyne Pass",',
            '"description":"Hold a Dualyne Pass and your wallet has Dualyne Pro: every AI model in Chat (GPT-5, Gemini, Claude and more) with Pro daily limits, for as long as you hold it. Sign in at dualyne.com with the wallet that holds it.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg(1, a, b, "0001"))), '",',
            '"external_link":"https://dualyne.com/pass"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /* ─────────── artwork ─────────── */

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        (string memory name, string memory a, string memory b) = _palette(tokenId % 6);
        string memory num = _pad(tokenId);
        string memory json = string.concat(
            '{"name":"Dualyne Pass #', num,
            '","description":"Holding a Dualyne Pass gives your wallet Dualyne Pro: every AI model in Chat, with Pro daily limits, for as long as you hold it. dualyne.com",',
            '"attributes":[{"trait_type":"Color","value":"', name, '"}],',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg(tokenId, a, b, num))), '"}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _palette(uint256 i) internal pure returns (string memory, string memory, string memory) {
        if (i == 0) return ("Violet", "#7C5CFF", "#22D3EE");
        if (i == 1) return ("Orchid", "#A78BFA", "#F472B6");
        if (i == 2) return ("Mint", "#34D399", "#22D3EE");
        if (i == 3) return ("Sunset", "#F59E0B", "#F472B6");
        if (i == 4) return ("Ocean", "#60A5FA", "#A78BFA");
        return ("Ember", "#F87171", "#FBBF24");
    }

    function _pad(uint256 id) internal pure returns (string memory) {
        string memory s = id.toString();
        if (id < 10) return string.concat("000", s);
        if (id < 100) return string.concat("00", s);
        if (id < 1000) return string.concat("0", s);
        return s;
    }

    /// @dev Keep in step with passSvg() in packages/shared/src/pass.ts.
    function svg(uint256 tokenId, string memory a, string memory b, string memory num)
        internal
        pure
        returns (string memory)
    {
        string memory id = tokenId.toString();
        return string.concat(
            string.concat(
                "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'>",
                "<defs><linearGradient id='g", id, "' x1='0' y1='0' x2='1' y2='1'>",
                "<stop offset='0' stop-color='", a, "'/><stop offset='1' stop-color='", b, "'/></linearGradient>",
                "<radialGradient id='r", id, "' cx='.3' cy='.2' r='.9'>",
                "<stop offset='0' stop-color='", a, "' stop-opacity='.35'/><stop offset='1' stop-color='", a,
                "' stop-opacity='0'/></radialGradient></defs>"
            ),
            string.concat(
                "<rect width='600' height='600' fill='#07070A'/>",
                "<rect width='600' height='600' fill='url(#r", id, ")'/>",
                "<rect x='60' y='120' width='480' height='360' rx='28' fill='#0E0E13' stroke='url(#g", id,
                ")' stroke-width='3'/>",
                "<path d='M104 176l22 18-22 18' fill='none' stroke='url(#g", id,
                ")' stroke-width='7' stroke-linecap='round' stroke-linejoin='round'/>",
                "<path d='M138 200h26M138 212h18' stroke='url(#g", id, ")' stroke-width='6' stroke-linecap='round'/>"
            ),
            string.concat(
                "<text x='104' y='300' font-family='monospace' font-size='44' font-weight='700' fill='#F4F4F6'>DUALYNE PASS</text>",
                "<text x='104' y='346' font-family='monospace' font-size='20' fill='#9A9AA6'>Pro access &#183; every model</text>",
                "<text x='104' y='432' font-family='monospace' font-size='22' fill='url(#g", id, ")'>#", num, "</text>",
                "<text x='496' y='432' text-anchor='end' font-family='monospace' font-size='18' fill='#6B6B78'>dualyne.com</text>",
                "</svg>"
            )
        );
    }
}
