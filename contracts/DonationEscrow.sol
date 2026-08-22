pragma solidity ^0.8.20;

contract DonationEscrow {
    address public admin;
    mapping(bytes32 => bool) public processedInvoices;

    event FundsReleased(address indexed ngo, uint256 amount);
    event ClaimRejected(address indexed ngo, string reason);

    constructor() {
        admin = msg.sender;
    }

    function releaseFunds(address ngo, uint256 amount, bytes32 invoiceHash) external {
        require(msg.sender == admin);
        require(!processedInvoices[invoiceHash]);
        
        processedInvoices[invoiceHash] = true;
        emit FundsReleased(ngo, amount);
    }

    function rejectClaim(address ngo, bytes32 invoiceHash, string memory reason) external {
        require(msg.sender == admin);
        
        processedInvoices[invoiceHash] = true;
        emit ClaimRejected(ngo, reason);
    }
}