// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

contract DonationEscrow is ReentrancyGuard {
    enum MilestoneStatus { Inactive, Pending, Submitted, Approved, Rejected }

    struct Milestone {
        string description;
        uint256 budgetAmount;
        string invoiceIpfsHash;
        bytes32 invoiceSha256;
        uint256 claimedAmount;
        MilestoneStatus status;
    }

    struct Campaign {
        string title;
        address payable ngoAddress;
        address auditorAddress;
        uint256 goalAmount;
        uint256 totalRaised;
        uint256 totalReleased;
        uint256 milestoneCount;
        bool exists;
    }

    mapping(uint256 => Campaign) public campaigns;
    mapping(uint256 => mapping(uint256 => Milestone)) public milestones;
    mapping(bytes32 => bool) public processedInvoices;
    uint256 public campaignCounter;

    event CampaignCreated(uint256 indexed campaignId, string title, address indexed ngo, address auditor, uint256 goal);
    event DonationReceived(uint256 indexed campaignId, address indexed donor, uint256 amount);
    event MilestoneExpenseSubmitted(uint256 indexed campaignId, uint256 indexed milestoneId, bytes32 invoiceHash, uint256 amount);
    event ExpenseApproved(uint256 indexed campaignId, uint256 indexed milestoneId, uint256 amountReleased);
    event ExpenseRejected(uint256 indexed campaignId, uint256 indexed milestoneId, string reason);

    modifier onlyNGO(uint256 _campaignId) {
        require(msg.sender == campaigns[_campaignId].ngoAddress, "Only campaign NGO authorized");
        _;
    }

    modifier onlyAuditor(uint256 _campaignId) {
        require(msg.sender == campaigns[_campaignId].auditorAddress, "Only assigned auditor authorized");
        _;
    }

    function createCampaign(
        string calldata _title,
        address _auditor,
        uint256 _goalAmount,
        string[] calldata _milestoneDescriptions,
        uint256[] calldata _milestoneBudgets
    ) external returns (uint256) {
        require(_milestoneDescriptions.length == _milestoneBudgets.length, "Milestone mismatch");
        require(_milestoneDescriptions.length > 0, "At least one milestone required");

        campaignCounter++;
        uint256 newId = campaignCounter;

        campaigns[newId] = Campaign({
            title: _title,
            ngoAddress: payable(msg.sender),
            auditorAddress: _auditor,
            goalAmount: _goalAmount,
            totalRaised: 0,
            totalReleased: 0,
            milestoneCount: _milestoneDescriptions.length,
            exists: true
        });

        for (uint256 i = 0; i < _milestoneDescriptions.length; i++) {
            milestones[newId][i] = Milestone({
                description: _milestoneDescriptions[i],
                budgetAmount: _milestoneBudgets[i],
                invoiceIpfsHash: "",
                invoiceSha256: bytes32(0),
                claimedAmount: 0,
                status: MilestoneStatus.Pending
            });
        }

        emit CampaignCreated(newId, _title, msg.sender, _auditor, _goalAmount);
        return newId;
    }

    function donate(uint256 _campaignId) external payable {
        require(campaigns[_campaignId].exists, "Campaign does not exist");
        require(msg.value > 0, "Donation must be greater than zero");

        campaigns[_campaignId].totalRaised += msg.value;
        emit DonationReceived(_campaignId, msg.sender, msg.value);
    }

    function submitExpense(
        uint256 _campaignId,
        uint256 _milestoneId,
        string calldata _ipfsHash,
        bytes32 _invoiceSha256,
        uint256 _claimedAmount
    ) external onlyNGO(_campaignId) {
        Milestone storage ms = milestones[_campaignId][_milestoneId];
        require(ms.status == MilestoneStatus.Pending, "Milestone not pending submission");
        require(!processedInvoices[_invoiceSha256], "Duplicate invoice detected: already processed");

        ms.invoiceIpfsHash = _ipfsHash;
        ms.invoiceSha256 = _invoiceSha256;
        ms.claimedAmount = _claimedAmount;
        ms.status = MilestoneStatus.Submitted;

        emit MilestoneExpenseSubmitted(_campaignId, _milestoneId, _invoiceSha256, _claimedAmount);
    }

    function approveAndDisburse(
        uint256 _campaignId,
        uint256 _milestoneId
    ) external onlyAuditor(_campaignId) nonReentrant {
        Campaign storage camp = campaigns[_campaignId];
        Milestone storage ms = milestones[_campaignId][_milestoneId];

        require(ms.status == MilestoneStatus.Submitted, "Expense must be in Submitted state");
        require(ms.claimedAmount <= ms.budgetAmount, "Claim exceeds milestone budget");
        require(address(this).balance >= ms.claimedAmount, "Insufficient escrow contract balance");

        ms.status = MilestoneStatus.Approved;
        processedInvoices[ms.invoiceSha256] = true;
        camp.totalReleased += ms.claimedAmount;

        camp.ngoAddress.transfer(ms.claimedAmount);

        emit ExpenseApproved(_campaignId, _milestoneId, ms.claimedAmount);
    }

    function rejectExpense(
        uint256 _campaignId,
        uint256 _milestoneId,
        string calldata _reason
    ) external onlyAuditor(_campaignId) {
        Milestone storage ms = milestones[_campaignId][_milestoneId];
        require(ms.status == MilestoneStatus.Submitted, "Expense not submitted");

        ms.status = MilestoneStatus.Rejected;
        emit ExpenseRejected(_campaignId, _milestoneId, _reason);
    }

    function getMilestone(uint256 _campaignId, uint256 _milestoneId) external view returns (Milestone memory) {
        return milestones[_campaignId][_milestoneId];
    }
}