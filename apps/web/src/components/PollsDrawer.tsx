import React, { useState } from 'react';
import { type Poll } from '@popcorn/shared';
import { socket } from '../lib/socket';
import { useRoomStore } from '../stores/room-store';
import './PollsDrawer.css';

interface PollsDrawerProps {
  polls: Poll[];
  isOpen: boolean;
  onClose: () => void;
}

export function PollsDrawer({ polls, isOpen, onClose }: PollsDrawerProps) {
  const { snapshot } = useRoomStore();
  const youId = snapshot?.you || '';
  const isHost = snapshot?.hostId === youId;

  const [isCreating, setIsCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [kind, setKind] = useState<'single' | 'elimination'>('single');
  const [options, setOptions] = useState<string[]>(['', '']);

  const handleVote = (pollId: string, optionId: string) => {
    socket.emit('poll:vote', { pollId, optionId });
  };

  const handleClosePoll = (pollId: string) => {
    socket.emit('poll:close', { pollId });
  };

  const handleAddOption = () => {
    if (options.length < 6) setOptions([...options, '']);
  };

  const handleOptionChange = (idx: number, val: string) => {
    const updated = [...options];
    updated[idx] = val;
    setOptions(updated);
  };

  const handleCreatePoll = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanQuestion = question.trim();
    const validOptions = options.map((o) => o.trim()).filter(Boolean);

    if (!cleanQuestion || validOptions.length < 2) return;

    socket.emit('poll:create', {
      question: cleanQuestion,
      kind,
      options: validOptions.map((label) => ({ label })),
    });

    setQuestion('');
    setOptions(['', '']);
    setIsCreating(false);
  };

  return (
    <aside className={`polls-drawer chrome ${isOpen ? 'polls-drawer--open' : ''}`} aria-label="Group polls">
      <div className="polls-drawer-header">
        <div className="polls-title-group">
          <h3 className="polls-title">Group Polls</h3>
          <span className="polls-count">{polls.length}</span>
        </div>
        <button type="button" className="polls-close" onClick={onClose} aria-label="Close polls">
          ✕
        </button>
      </div>

      <div className="polls-actions-bar">
        {!isCreating ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsCreating(true)}
          >
            Create new poll
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setIsCreating(false)}
          >
            Cancel
          </button>
        )}
      </div>

      {isCreating && (
        <form onSubmit={handleCreatePoll} className="polls-create-form">
          <label className="form-label">
            Question
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What shall we screen next?"
              className="polls-input"
              required
            />
          </label>

          <label className="form-label">
            Poll type
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'single' | 'elimination')}
              className="polls-select"
            >
              <option value="single">Single choice</option>
              <option value="elimination">Elimination bracket</option>
            </select>
          </label>

          <div className="options-input-group">
            <span className="form-label">Options (min 2)</span>
            {options.map((opt, i) => (
              <input
                key={i}
                type="text"
                value={opt}
                onChange={(e) => handleOptionChange(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="polls-input"
                required
              />
            ))}
            {options.length < 6 && (
              <button
                type="button"
                className="btn-add-option"
                onClick={handleAddOption}
              >
                + Add option
              </button>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-sm">
            Launch poll
          </button>
        </form>
      )}

      <div className="polls-list">
        {polls.length === 0 && !isCreating ? (
          <div className="polls-empty">
            <p>No active polls.</p>
            <p className="polls-empty-sub">Launch a poll to pick the next film together.</p>
          </div>
        ) : (
          polls.map((poll) => {
            const totalVotes = poll.options.reduce((sum, o) => sum + o.votes.length, 0);

            return (
              <div key={poll.id} className="poll-card">
                <div className="poll-card-header">
                  <span className="poll-kind-badge">
                    {poll.kind === 'elimination'
                      ? `Elimination • Round ${poll.round || 1}`
                      : 'Single choice'}
                  </span>
                  <span className={`poll-status-tag ${poll.status === 'closed' ? 'poll-status--closed' : ''}`}>
                    {poll.status === 'open' ? 'Live' : 'Closed'}
                  </span>
                </div>

                <h4 className="poll-question">{poll.question}</h4>

                <div className="poll-options-list">
                  {poll.options.map((opt) => {
                    const hasVoted = opt.votes.includes(youId);
                    const pct = totalVotes > 0 ? Math.round((opt.votes.length / totalVotes) * 100) : 0;

                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={poll.status === 'closed' || opt.eliminated}
                        onClick={() => handleVote(poll.id, opt.id)}
                        className={`poll-option-btn ${hasVoted ? 'poll-option-btn--voted' : ''} ${opt.eliminated ? 'poll-option-btn--eliminated' : ''}`}
                      >
                        <div
                          className="poll-option-bar"
                          style={{ width: `${pct}%` }}
                        />
                        <div className="poll-option-content">
                          <span className="poll-option-label">
                            {opt.label}
                            {opt.eliminated && ' (Eliminated)'}
                          </span>
                          <span className="poll-option-stats">
                            {opt.votes.length} ({pct}%)
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {isHost && poll.status === 'open' && (
                  <div className="poll-host-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleClosePoll(poll.id)}
                    >
                      {poll.kind === 'elimination' ? 'Close round / eliminate' : 'Close poll'}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
