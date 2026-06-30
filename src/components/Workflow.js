import React, { useState } from 'react';
import WorkflowA from './WorkflowA';
import WorkflowB from './WorkflowB';
import WorkflowD from './WorkflowD';
import WorkflowE from './WorkflowE';

const WORKFLOWS = [
  {
    id: 'A',
    icon: '🌅',
    title: 'Change Background',
    description: 'Swap the background of any product image. Choose from your library or generate a new scene.',
    badge: null,
    badgeClass: 'badge-a',
  },
  {
    id: 'B',
    icon: '👤',
    title: 'Change Model',
    description: 'Place your garment on a different model. Select from your model library.',
    badge: null,
    badgeClass: 'badge-b',
  },
  {
    id: 'D',
    icon: '👗',
    title: 'Virtual Try-On',
    description: 'See any garment on any person. Upload a garment and a person photo.',
    badge: null,
    badgeClass: 'badge-d',
  },
  {
    id: 'E',
    icon: '🎯',
    title: 'Smart PDP Shoot',
    description: 'Category-aware PDP shoot — Topwear, Bottomwear, Footwear and more. Supports panoramic backgrounds with auto-crop per shot and multiple detail close-ups.',
    badge: null,
    badgeClass: 'badge-c',
  },
];

export default function Workflow({ onNavigate }) {
  const [activeWorkflow, setActiveWorkflow] = useState(null);

  if (activeWorkflow === 'A') return <WorkflowA onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'B') return <WorkflowB onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'D') return <WorkflowD onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;
  if (activeWorkflow === 'E') return <WorkflowE onBack={() => setActiveWorkflow(null)} onNavigate={onNavigate} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="screen-header">
        <h1>Workflows</h1>
        <p>Choose a workflow to start generating fashion photography</p>
      </div>

      <div className="screen-body">
        <div className="workflow-grid">
          {WORKFLOWS.map(wf => (
            <button
              key={wf.id}
              className="workflow-tile"
              onClick={() => setActiveWorkflow(wf.id)}
            >
              {wf.badge && <span className={`workflow-badge ${wf.badgeClass}`}>{wf.badge}</span>}
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
