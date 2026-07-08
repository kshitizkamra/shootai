import React, { useState } from 'react';
import WorkflowA from './WorkflowA';
import WorkflowB from './WorkflowB';
import WorkflowD from './WorkflowD';
import WorkflowE from './WorkflowE';
import WorkflowF from './WorkflowF';

const ALL_WORKFLOWS = [
  {
    id: 'A',
    icon: '🌅',
    title: 'Change Background',
    description: 'Swap the background of any product image. Choose from your library or generate a new scene.',
    badgeClass: 'badge-a',
  },
  {
    id: 'B',
    icon: '👤',
    title: 'Change Model',
    description: 'Place your garment on a different model. Select from your model library.',
    badgeClass: 'badge-b',
  },
  {
    id: 'D',
    icon: '👗',
    title: 'Virtual Try-On',
    description: 'See any garment on any person. Upload a garment and a person photo.',
    badgeClass: 'badge-d',
  },
  {
    id: 'E',
    icon: '🎯',
    title: 'Smart PDP Shoot',
    description: 'Category-aware PDP shoot — Topwear, Bottomwear, Footwear and more. Supports panoramic backgrounds with auto-crop per shot and multiple detail close-ups.',
    badgeClass: 'badge-c',
  },
  {
    id: 'F',
    icon: '🧵',
    title: 'Fabric Swap',
    description: 'Replace the fabric or print on any garment. Upload a swatch, set the repeat, and generate a full PDP shoot with the new fabric.',
    badgeClass: 'badge-c',
  },
];

export default function Workflow({ onNavigate, allowedWorkflows }) {
  const [activeWorkflow, setActiveWorkflow] = useState(null);

  if (activeWorkflow === 'A') return <WorkflowA onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'B') return <WorkflowB onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'D') return <WorkflowD onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'E') return <WorkflowE onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'F') return <WorkflowF onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;

  // Filter to only allowed workflows (null/undefined means show all)
  const visible = allowedWorkflows
    ? ALL_WORKFLOWS.filter(wf => allowedWorkflows.includes(wf.id))
    : ALL_WORKFLOWS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <h1>Workflows</h1>
        <p>Choose a workflow to start generating fashion photography</p>
      </div>

      <div className="screen-body">
        <div className="workflow-grid">
          {visible.map(wf => (
            <button
              key={wf.id}
              className="workflow-tile"
              onClick={() => setActiveWorkflow(wf.id)}
            >
              <span className="workflow-tile-icon">{wf.icon}</span>
              <div className="workflow-tile-title">{wf.title}</div>
              <div className="workflow-tile-desc">{wf.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
