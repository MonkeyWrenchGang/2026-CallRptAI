import React, { useState, useEffect } from 'react';

const SCHEDULES = [
  {
    id: 'A',
    name: 'Schedule A: Balance Sheet (Statement of Financial Condition)',
    description: 'Assets, liabilities, and equity. Captures total assets, cash, investments, loans, shares/deposits, borrowed funds, and net worth.',
    fields: [
      { db: 'total_assets', label: 'Total Assets' },
      { db: 'total_loans', label: 'Total Loans & Leases' },
      { db: 'total_shares', label: 'Total Shares & Deposits' },
      { db: 'net_worth', label: 'Net Worth (Retained Earnings + Equity)' },
      { db: 'cash', label: 'Cash & Cash Equivalents' },
      { db: 'land_building', label: 'Land and Building' },
      { db: 'other_fixed_assets', label: 'Other Fixed Assets' },
      { db: 'other_assets', label: 'Other Assets' },
      { db: 'leases_receivable', label: 'Leases Receivable' },
      { db: 'allowance_ll', label: 'Allowance for Loan & Lease Losses' },
    ],
  },
  {
    id: 'B',
    name: 'Schedule B: Income Statement',
    description: 'Revenue and expenses for the reporting period. Interest income, interest expense, provision for loan losses, non-interest income/expense, and net income.',
    fields: [
      { db: 'net_income', label: 'Net Income' },
      { db: 'gross_income', label: 'Total Gross Income' },
      { db: 'interest_on_loans', label: 'Interest on Loans (annualized)' },
      { db: 'investment_income', label: 'Investment Income (annualized)' },
      { db: 'fee_income', label: 'Fee Income (annualized)' },
      { db: 'dividends_on_shares', label: 'Dividends on Shares' },
      { db: 'provision_ll', label: 'Provision for Loan & Lease Losses' },
      { db: 'roa', label: 'Return on Assets (derived)' },
      { db: 'net_interest_margin', label: 'Net Interest Margin (derived)' },
      { db: 'efficiency_ratio', label: 'Efficiency Ratio (derived)' },
    ],
  },
  {
    id: 'C',
    name: 'Schedule C: Regulatory Capital',
    description: 'Net worth ratio calculation, risk-based capital (for complex CUs), and PCA classification. Determines if a CU is well-capitalized, adequately capitalized, or undercapitalized.',
    fields: [
      { db: 'net_worth_ratio', label: 'Net Worth Ratio (Net Worth / Total Assets)' },
      { db: 'subordinated_debt_in_nw', label: 'Subordinated Debt in Net Worth' },
    ],
  },
  {
    id: 'D',
    name: 'Schedule D: Investments',
    description: 'Detail of investment portfolio including securities type, maturity distribution, and fair value vs. book value.',
    fields: [],
  },
  {
    id: 'E',
    name: 'Schedule E: Loan Detail',
    description: 'Breakdown of loan portfolio by type: real estate (first mortgage, HELOCs), auto, credit card, commercial, and other consumer loans.',
    fields: [
      { db: 'total_loans', label: 'Total Loans (aggregate)' },
      { db: 'first_mortgage_re', label: '1st Mortgage RE Loans/LOCs' },
      { db: 'other_re_loans', label: 'Other RE Loans/LOCs' },
      { db: 'member_business_loans', label: 'Net Member Business Loans' },
    ],
  },
  {
    id: 'F',
    name: 'Schedule F: Delinquent Loans',
    description: 'Loans past due by aging bucket (60-89 days, 90-179 days, 180+ days). Critical for asset quality assessment.',
    fields: [
      { db: 'delinquency_ratio', label: 'Delinquency Ratio (derived)' },
      { db: 'loans_in_liquidation', label: 'Loans in Process of Liquidation' },
      { db: 'foreclosed_assets', label: 'Foreclosed & Repossessed Assets' },
    ],
  },
  {
    id: 'G',
    name: 'Schedule G: Charges and Recoveries',
    description: 'Net charge-offs by loan category. Shows loan losses actually realized during the period.',
    fields: [
      { db: 'chargeoffs_ytd', label: 'Total Loans Charged Off YTD' },
      { db: 'recoveries_ytd', label: 'Total Recoveries on Charged-Off Loans YTD' },
      { db: 'net_chargeoffs_ytd', label: 'Net Charge-Offs YTD (derived)' },
    ],
  },
  {
    id: 'H',
    name: 'Schedule H: Borrowings & Other Liabilities',
    description: 'Detail of borrowed funds, FHLB advances, subordinated debt, and other liabilities.',
    fields: [
      { db: 'borrowings_total', label: 'Total Borrowings/Repurchase Transactions' },
      { db: 'notes_payable', label: 'Notes & Promissory Notes Payable' },
    ],
  },
  {
    id: 'I',
    name: 'Schedule I: Shares/Deposits Detail',
    description: 'Breakdown of share/deposit accounts by type and maturity. Regular shares, share certificates, money market, IRAs.',
    fields: [
      { db: 'total_shares', label: 'Total Shares & Deposits (aggregate)' },
      { db: 'regular_shares', label: 'Regular Shares' },
      { db: 'other_shares', label: 'All Other Shares' },
    ],
  },
  {
    id: 'J',
    name: 'Schedule J: Membership & Demographic Info',
    description: 'Total members, potential members, and field of membership data.',
    fields: [
      { db: 'member_count', label: 'Total Members' },
    ],
  },
];

function fmtVal(val) {
  if (val == null) return '--';
  if (Math.abs(val) < 1) return `${(val * 100).toFixed(2)}%`;
  if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
  if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`;
  return val.toLocaleString();
}

export default function ScheduleDeepDive({ activeCU }) {
  const [expanded, setExpanded] = useState(null);
  const [cuData, setCuData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCU) { setCuData(null); return; }
    setLoading(true);
    fetch(`/api/ncua/institutions/${activeCU}`)
      .then((r) => r.json())
      .then((d) => {
        setCuData(d.latest || d);
        setLoading(false);
      })
      .catch(() => { setCuData(null); setLoading(false); });
  }, [activeCU]);

  const toggle = (id) => setExpanded(expanded === id ? null : id);

  return (
    <section className="compare-area">
      <div className="compare-header">
        <h2>NCUA 5300 Schedule Reference</h2>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        The NCUA 5300 Call Report consists of multiple schedules. Below is a reference guide showing
        what each schedule contains and which fields from our database map to it.
        {activeCU ? ` Showing actual values for CU ${activeCU}.` : ' Select a CU to see its actual values.'}
      </p>

      {loading && <p className="compare-message">Loading CU data...</p>}

      <div className="schedule-accordion">
        {SCHEDULES.map((sched) => (
          <div key={sched.id} className={`schedule-item ${expanded === sched.id ? 'is-expanded' : ''}`}>
            <button
              type="button"
              className="schedule-item-header"
              onClick={() => toggle(sched.id)}
            >
              <span className="schedule-item-id">Sch. {sched.id}</span>
              <span className="schedule-item-name">{sched.name}</span>
              <span className="schedule-item-chevron">{expanded === sched.id ? '\u25B2' : '\u25BC'}</span>
            </button>
            {expanded === sched.id && (
              <div className="schedule-item-body">
                <p className="schedule-item-desc">{sched.description}</p>
                {sched.fields.length > 0 ? (
                  <table className="pulse-table schedule-fields-table">
                    <thead>
                      <tr>
                        <th>Database Field</th>
                        <th>Description</th>
                        {cuData && <th>Current Value</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sched.fields.map((f) => (
                        <tr key={f.db}>
                          <td className="mono" style={{ fontSize: 11 }}>{f.db}</td>
                          <td>{f.label}</td>
                          {cuData && (
                            <td className="mono">{fmtVal(cuData[f.db])}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                    No mapped fields in our database for this schedule. Raw data available in full 5300 filings.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
