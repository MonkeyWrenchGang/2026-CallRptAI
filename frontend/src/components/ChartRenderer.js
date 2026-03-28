import React from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#1d9e75', '#085041', '#639922', '#ef9f27', '#2563eb', '#9333ea', '#e11d48', '#0891b2'];

const RATIO_FIELDS = [
  'roa', 'net_worth_ratio', 'net_interest_margin', 'delinquency_ratio',
  'efficiency_ratio', 'loan_to_share_ratio', 'nwr', 'nim',
];

const DOLLAR_FIELDS = [
  'total_assets', 'total_loans', 'total_shares', 'total_equity', 'cash',
  'net_income', 'interest_income', 'assets',
];

function isRatioField(field) {
  return RATIO_FIELDS.some((r) => field.toLowerCase().includes(r));
}

function isDollarField(field) {
  return DOLLAR_FIELDS.some((d) => field.toLowerCase().includes(d));
}

function formatTooltip(value, name) {
  if (isRatioField(name)) return `${(value * 100).toFixed(2)}%`;
  if (isDollarField(name)) {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    return `$${value.toLocaleString()}`;
  }
  return typeof value === 'number' ? value.toLocaleString() : value;
}

function formatYTick(value, yField) {
  if (isRatioField(yField)) return `${(value * 100).toFixed(1)}%`;
  if (isDollarField(yField)) {
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return `$${value}`;
  }
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value;
}

export default function ChartRenderer({ vizConfig, data }) {
  if (!vizConfig || !data?.rows?.length) return null;

  const { chart_type, x_field, y_field, title } = vizConfig;

  if (!data.columns.includes(x_field) || !data.columns.includes(y_field)) return null;

  const chartData = data.rows.map((row) => ({
    ...row,
    [y_field]: Number(row[y_field]) || 0,
  }));

  const label = (name) => name.replace(/_/g, ' ');

  return (
    <div className="chart-container">
      {title && <div className="chart-title">{title}</div>}
      <ResponsiveContainer width="100%" height={300}>
        {chart_type === 'line' ? (
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey={x_field} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatYTick(v, y_field)} />
            <Tooltip formatter={(v, n) => [formatTooltip(v, n), label(n)]} />
            <Line
              type="monotone"
              dataKey={y_field}
              stroke="#1d9e75"
              strokeWidth={2}
              dot={{ fill: '#1d9e75', r: 4 }}
              name={y_field}
            />
          </LineChart>
        ) : chart_type === 'pie' ? (
          <PieChart>
            <Pie
              data={chartData}
              dataKey={y_field}
              nameKey={x_field}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ name, value }) => `${name}: ${formatTooltip(value, y_field)}`}
              labelLine={{ stroke: 'rgba(0,0,0,0.2)' }}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v, n) => [formatTooltip(v, y_field), n]} />
          </PieChart>
        ) : (
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
            <XAxis dataKey={x_field} tick={{ fontSize: 11, angle: -25 }} interval={0} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatYTick(v, y_field)} />
            <Tooltip formatter={(v, n) => [formatTooltip(v, n), label(n)]} />
            <Bar dataKey={y_field} fill="#1d9e75" name={y_field} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
