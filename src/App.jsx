import { useEffect, useMemo, useRef, useState } from 'react';
import { QUESTIONS, SECTIONS } from './data';
import './App.css';

const STORAGE_KEY = 'sql_query_bench_v1';
const STORAGE_VERSION = 2;
const TOTAL_SECONDS = 45 * 60;
const SESSION_SIZE = 50;
const LETTERS = ['A', 'B', 'C', 'D'];

function sectionFor(num) {
  return SECTIONS.find((s) => num >= s.from && num <= s.to)?.name || 'General';
}

function highlightSQL(code) {
  const kws = [
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'DATABASE',
    'ALTER', 'DROP', 'TRUNCATE', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CHECK', 'GROUP', 'BY', 'HAVING', 'ORDER',
    'ASC', 'DESC', 'LIMIT', 'OFFSET', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'ON', 'UNION', 'ALL', 'AND',
    'OR', 'NOT', 'NULL', 'IN', 'BETWEEN', 'LIKE', 'IS', 'DISTINCT', 'AS', 'CASCADE', 'COLUMN', 'ADD', 'MODIFY',
    'RENAME', 'TO', 'IF', 'EXISTS', 'COUNT', 'AVG', 'SUM', 'MAX', 'MIN',
  ];
  const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const re = new RegExp('\\b(' + kws.join('|') + ')\\b', 'g');
  return escaped.replace(re, '<span class="kw">$1</span>');
}

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function shuffleQuestionOptions(question) {
  const sourceOptions = [...question.options];
  const correctText = sourceOptions[LETTERS.indexOf(question.answer)];
  const options = shuffleArray(sourceOptions);
  const answer = String.fromCharCode(65 + options.indexOf(correctText));
  return { ...question, options, answer };
}

function buildShuffledQueue(questions) {
  return shuffleArray(questions)
    .slice(0, SESSION_SIZE)
    .map((q) => shuffleQuestionOptions(q));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.version !== STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.activeQueue) || parsed.activeQueue.length !== SESSION_SIZE) return null;
    const current = typeof parsed.current === 'number' ? parsed.current : 0;
    if (current < 0 || current >= parsed.activeQueue.length) return null;
    const answers = typeof parsed.answers === 'object' && parsed.answers ? parsed.answers : {};
    if (Object.keys(answers).length > parsed.activeQueue.length) return null;
    return {
      current,
      answers,
      remainingSeconds:
        typeof parsed.remainingSeconds === 'number' ? parsed.remainingSeconds : TOTAL_SECONDS,
      penalties: typeof parsed.penalties === 'number' ? parsed.penalties : 0,
      activeQueue: parsed.activeQueue,
    };
  } catch (e) {
    return null;
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: STORAGE_VERSION }));
  } catch (e) {
    // ignore storage failures
  }
}

export default function App() {
  const [screen, setScreen] = useState('intro');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(TOTAL_SECONDS);
  const [activeQueue, setActiveQueue] = useState(QUESTIONS);
  const [resumeCount, setResumeCount] = useState(0);
  const [penalties, setPenalties] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const timerRef = useRef(null);
  const autoAdvanceRef = useRef(null);

  useEffect(() => {
    const saved = loadState();
    if (saved && Object.keys(saved.answers).length > 0) {
      setCurrent(saved.current);
      setAnswers(saved.answers);
      setRemainingSeconds(saved.remainingSeconds);
      setPenalties(saved.penalties);
      setResumeCount(Object.keys(saved.answers).length);
      setActiveQueue(saved.activeQueue || QUESTIONS);
      const totalCount = saved.activeQueue?.length || QUESTIONS.length;
      if (Object.keys(saved.answers).length < totalCount) {
        setScreen('quiz');
      } else {
        setScreen('results');
      }
    }
  }, []);

  useEffect(() => {
    saveState({ current, answers, remainingSeconds, penalties, activeQueue });
  }, [current, answers, remainingSeconds, penalties, activeQueue]);

  useEffect(() => {
    if (screen !== 'quiz') {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          finishQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (autoAdvanceRef.current) {
        clearTimeout(autoAdvanceRef.current);
        autoAdvanceRef.current = null;
      }
    };
  }, [screen]);

  const activeQuestion = activeQueue[current];
  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter((item) => item.correct).length;
  const wrongCount = Object.values(answers).filter((item) => item && item.selected !== null && !item.correct).length;
  const skippedCount = Object.values(answers).filter((item) => item?.skipped).length;
  const finalScore = correctCount - wrongCount - penalties;
  const displayPct = activeQueue.length ? Math.max(0, Math.min(100, Math.round((finalScore / activeQueue.length) * 100))) : 0;
  const progressPercent = activeQueue.length ? (current / activeQueue.length) * 100 : 0;
  const timerMinutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
  const isQuizComplete = answeredCount === activeQueue.length;
  const timerSeconds = String(remainingSeconds % 60).padStart(2, '0');
  const showFinishHint = current === activeQueue.length - 1 && Boolean(currentAnswer);

  const gradeData = useMemo(() => {
    const pct = displayPct;
    if (pct >= 90) {
      return {
        grade: 'Excellent — mastery level',
        note:
          'You clearly know your way around a schema. Revisit any misses below, then move on to harder query-writing practice.',
        color: '#7ee787',
        pct,
      };
    }
    if (pct >= 70) {
      return {
        grade: 'Solid — minor gaps',
        note: 'Good grasp of the fundamentals. Check the weak-spot breakdown below and re-read those sections.',
        color: '#4fd6c4',
        pct,
      };
    }
    if (pct >= 50) {
      return {
        grade: 'Getting there',
        note: 'You have the basics but several sections need review. Focus on the lowest-scoring topics below.',
        color: '#e3b341',
        pct,
      };
    }
    return {
      grade: 'Needs a re-run',
      note: 'Worth revisiting the fundamentals doc from the top before retaking this test.',
      color: '#ff7b72',
      pct,
    };
  }, [displayPct]);

  const summaryBySection = useMemo(() => {
    const bySection = {};
    SECTIONS.forEach((section) => {
      bySection[section.name] = { correct: 0, total: 0 };
    });
    activeQueue.forEach((q) => {
      const sectionName = sectionFor(q.num);
      if (!bySection[sectionName]) bySection[sectionName] = { correct: 0, total: 0 };
      bySection[sectionName].total += 1;
      const answer = answers[q.num];
      if (answer && answer.correct) bySection[sectionName].correct += 1;
    });
    return Object.entries(bySection).filter(([, value]) => value.total > 0);
  }, [answers, activeQueue]);

  const weakSections = useMemo(() => {
    return summaryBySection
      .map(([name, value]) => ({ name, ...value, pct: value.total ? value.correct / value.total : 0 }))
      .filter((item) => item.pct < 1)
      .sort((a, b) => a.pct - b.pct);
  }, [summaryBySection]);

  const handleStart = () => {
    const queue = buildShuffledQueue(QUESTIONS);
    setActiveQueue(queue);
    setCurrent(0);
    setAnswers({});
    setRemainingSeconds(TOTAL_SECONDS);
    setPenalties(0);
    localStorage.removeItem(STORAGE_KEY);
    setScreen('quiz');
    setShowReview(false);
  };

  const handleResume = () => {
    setScreen('quiz');
    setShowReview(false);
  };

  const handleRestartFresh = () => {
    localStorage.removeItem(STORAGE_KEY);
    const queue = buildShuffledQueue(QUESTIONS);
    setActiveQueue(queue);
    setCurrent(0);
    setAnswers({});
    setRemainingSeconds(TOTAL_SECONDS);
    setPenalties(0);
    setScreen('quiz');
    setShowReview(false);
  };

  const handleSelect = (letter) => {
    if (answers[activeQuestion.num]) return;
    const correct = letter === activeQuestion.answer;
    const nextAnswers = {
      ...answers,
      [activeQuestion.num]: { selected: letter, correct },
    };
    setAnswers(nextAnswers);
    // Auto-advance shortly after selection to avoid accidental missed clicks
    if (autoAdvanceRef.current) clearTimeout(autoAdvanceRef.current);
    autoAdvanceRef.current = setTimeout(() => {
      if (current < activeQueue.length - 1) {
        setCurrent((prev) => prev + 1);
      } else {
        finishQuiz();
      }
    }, 450);
  };

  const handleSkip = () => {
    if (answers[activeQuestion.num]) return;
    const nextAnswers = {
      ...answers,
      [activeQuestion.num]: { selected: null, correct: false, skipped: true },
    };
    setAnswers(nextAnswers);
    if (current < activeQueue.length - 1) {
      setCurrent((prev) => prev + 1);
    } else {
      finishQuiz();
    }
  };

  const handleAddTime = () => {
    setRemainingSeconds((prev) => prev + 15 * 60);
    setPenalties((prev) => prev + 1);
  };

  const finishQuiz = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setScreen('results');
  };

  const handlePrev = () => {
    if (current > 0) setCurrent((prev) => prev - 1);
  };

  const handleNext = () => {
    if (current < activeQueue.length - 1) {
      setCurrent((prev) => prev + 1);
    } else {
      finishQuiz();
    }
  };

  const handleRetry = () => {
    const queue = buildShuffledQueue(QUESTIONS);
    setActiveQueue(queue);
    setCurrent(0);
    setAnswers({});
    setRemainingSeconds(TOTAL_SECONDS);
    setPenalties(0);
    localStorage.removeItem(STORAGE_KEY);
    setScreen('quiz');
    setShowReview(false);
  };

  const handleRetryWrong = () => {
    const missed = QUESTIONS.filter((q) => {
      const answer = answers[q.num];
      return !answer || !answer.correct;
    });
    if (missed.length === 0) {
      alert('No missed questions — nice work!');
      return;
    }
    const queue = buildShuffledQueue(missed);
    setActiveQueue(queue);
    setCurrent(0);
    setAnswers({});
    setRemainingSeconds(TOTAL_SECONDS);
    setPenalties(0);
    localStorage.removeItem(STORAGE_KEY);
    setScreen('quiz');
    setShowReview(false);
  };

  const currentAnswer = answers[activeQuestion?.num];

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="dot-row">
            <span className="dot r" />
            <span className="dot y" />
            <span className="dot g" />
          </div>
          <div className="brand-name">
            <b>query_bench</b> — sql_50.session
          </div>
        </div>
        <div className="conn-status">
          <span className="pulse" />connected
        </div>
      </div>

      <section className={screen === 'intro' ? 'screen active' : 'screen'} id="intro">
        <div className="query-line">
          <span className="kw">SELECT</span> * <span className="kw">FROM</span> sql_fundamentals <span className="kw">LIMIT</span> 50;
        </div>
        <h1>
          Test your <span className="accentword">SQL</span> fundamentals.
        </h1>
        <p className="lead">
          50 questions pulled from the full 100-question topic pool: data types, keys, constraints, joins, aggregates, subqueries and more. One question at a time, instant feedback, full review at the end. You have 45 minutes to complete the full quiz.
        </p>

        <div className="schema-panel">
          <div className="row">
            <span className="col-name">questions</span>
            <span className="col-type">50 rows</span>
          </div>
          <div className="row">
            <span className="col-name">format</span>
            <span className="col-type">single-select · 4 options</span>
          </div>
          <div className="row">
            <span className="col-name">topics</span>
            <span className="col-type">21 sections · keys, joins, aggregates, DDL/DML…</span>
          </div>
          <div className="row">
            <span className="col-name">scoring</span>
            <span className="col-type">instant, per-question</span>
          </div>
        </div>

        <button className="start-btn" id="start-btn" type="button" onClick={handleStart}>
          ▸ RUN QUERY — Start Test
        </button>
        {resumeCount > 0 && resumeCount < activeQueue.length && (
          <div className="resume-note">
            Unfinished session found (<span id="resume-count">{resumeCount}</span> answered).{' '}
            <button type="button" onClick={handleResume}>Resume</button> or{' '}
            <button type="button" onClick={handleRestartFresh}>start over</button>.
          </div>
        )}
      </section>

      <section className={screen === 'quiz' ? 'screen active' : 'screen'} id="quiz">
        <div className="progress-bar-track">
          <div className="progress-bar-fill" id="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="status-row">
          <span className="rowcount">
            session <b id="q-index">{current + 1}</b> / {activeQueue.length}
          </span>
          <span className="section-tag" id="section-tag">
            {sectionFor(activeQuestion?.num || 1)}
          </span>
          <span className={`timer-chip${remainingSeconds <= 60 ? ' urgent' : ''}`}>
            time <b id="time-left">{timerMinutes}:{timerSeconds}</b>
          </span>
          <button className="btn time-boost-btn" type="button" onClick={handleAddTime} title="Add 15 minutes (−1 penalty)" aria-label="Add 15 minutes with one point penalty">
            <span className="btn-icon">⏱</span>
          </button>
          <span className="score-chip">
            score <b id="live-score">{finalScore}</b>/<span id="live-answered">{answeredCount}</span>
            {penalties > 0 ? <span className="penalty-chip"> −{penalties}</span> : null}
          </span>
        </div>

        <div className="q-card">
          <div className="q-eyebrow">
            session question <span id="q-num">{current + 1}</span> / {activeQueue.length}
          </div>
          <p className="q-text" id="q-text">{activeQuestion?.text}</p>
          <div className="source-note">
            original question #{activeQuestion?.num}
          </div>
          {activeQuestion?.code ? (
            <div className="q-code" id="q-code-wrap">
              <pre id="q-code" dangerouslySetInnerHTML={{ __html: highlightSQL(activeQuestion.code) }} />
            </div>
          ) : null}
          <div className="options" id="options">
            {activeQuestion?.options.map((opt, index) => {
              const letter = LETTERS[index];
              const selected = currentAnswer?.selected === letter;
              const correct = activeQuestion.answer === letter;
              const classes = ['option'];
              if (selected) classes.push('selected');
              if (currentAnswer) classes.push('locked');
              if (selected && correct) classes.push('correct');
              if (selected && !correct) classes.push('incorrect');

              return (
                <button
                  key={letter}
                  type="button"
                  className={classes.join(' ')}
                  disabled={Boolean(currentAnswer)}
                  onClick={() => handleSelect(letter)}
                >
                  <span className="letter">{letter}</span>
                  <span>{opt}</span>
                </button>
              );
            })}
          </div>
          {currentAnswer ? (
            <div className={`feedback-line show ${currentAnswer.correct ? 'good' : 'bad'}`} id="feedback">
              {currentAnswer.correct
                ? `✓ Correct — answer is ${activeQuestion.answer}.`
                : currentAnswer.skipped
                ? `⚠️ Skipped — marked as 0 and moved on.`
                : `✗ Not quite — correct answer is ${activeQuestion.answer}.`}
            </div>
          ) : null}
        </div>

        <div className="nav-row">
          <button className="btn" id="prev-btn" type="button" onClick={handlePrev} disabled={current === 0} aria-label="Previous question">
            <span className="btn-icon">⟵</span>
          </button>
          <button className="btn skip-btn" id="skip-btn" type="button" onClick={handleSkip} disabled={Boolean(currentAnswer)} aria-label="Skip question and mark as zero">
            <span className="btn-icon">⏭</span>
          </button>
          <button className="btn primary" id="next-btn" type="button" onClick={handleNext} disabled={!currentAnswer} aria-label={current < activeQueue.length - 1 ? 'Next question' : 'View final report'}>
            <span className="btn-icon">{current < activeQueue.length - 1 ? '⟶' : '✔'}</span>
            <span className="btn-text">{current < activeQueue.length - 1 ? 'Next' : 'View final report'}</span>
          </button>
        </div>
        {showFinishHint ? (
          <div className="finish-hint">Finish quiz to unlock the final report and weak-area summary.</div>
        ) : null}
      </section>

      <section className={screen === 'results' ? 'screen active' : 'screen'} id="results">
        <div className="query-line">
          <span className="kw">SELECT</span> * <span className="kw">FROM</span> session_results;
        </div>
        <h1 id="results-title">Query complete.</h1>
        <div className="result-sub" id="results-sub">
          {answeredCount} of {activeQueue.length} rows answered
        </div>

        <div className="score-panel">
          <div className="score-ring">
            <svg width="104" height="104">
              <circle cx="52" cy="52" r="46" stroke="#232b38" strokeWidth="8" fill="none" />
              <circle
                id="ring-progress"
                cx="52"
                cy="52"
                r="46"
                stroke={gradeData.color}
                strokeWidth="8"
                fill="none"
                strokeDasharray={2 * Math.PI * 46}
                strokeDashoffset={2 * Math.PI * 46 * (1 - gradeData.pct / 100)}
                strokeLinecap="round"
              />
            </svg>
            <div className="ring-label" id="ring-label">
              {gradeData.pct}%
            </div>
          </div>
          <div className="score-meta">
            <div className="grade" id="grade-text">{gradeData.grade}</div>
            <div className="grade-note" id="grade-note">{gradeData.note}</div>
          </div>
        </div>

        <div className="section-breakdown">
          <h3>Weak spots by section</h3>
          <div id="sb-list">
            {summaryBySection.map(([name, value]) => {
              const pct = value.total ? value.correct / value.total : 0;
              const fillClass = pct >= 0.75 ? '' : pct >= 0.5 ? 'mid' : 'weak';
              return (
                <div className="sb-row" key={name}>
                  <span className="sb-label">{name}</span>
                  <span className="sb-track">
                    <span className={`sb-fill ${fillClass}`} style={{ width: `${pct * 100}%` }} />
                  </span>
                  <span className="sb-count">{value.correct}/{value.total}</span>
                </div>
              );
            })}
          </div>
          {isQuizComplete ? (
            weakSections.length > 0 ? (
              <div className="weak-notice">
                Focus first on: {weakSections.slice(0, 3).map((item) => item.name).join(', ')}.
              </div>
            ) : (
              <div className="weak-notice">No weak sections detected — great work.</div>
            )
          ) : (
            <div className="weak-notice">
              Full weak-area recommendations are available after you complete the current quiz set.
            </div>
          )}
        </div>

        {isQuizComplete ? (
          <>
            <button className="review-toggle" id="review-toggle-btn" type="button" onClick={() => setShowReview(!showReview)}>
              {showReview ? 'Hide full report ▴' : 'View full report ▾'}
            </button>
            <div id="review-wrap" className={showReview ? 'show' : ''}>
              <div className="review-list" id="review-list">
                {activeQueue.map((q) => {
                  const answer = answers[q.num];
                  const wasCorrect = answer?.correct;
                  const yourText = answer?.selected ? q.options[LETTERS.indexOf(answer.selected)] : 'Skipped';
                  const correctText = q.options[LETTERS.indexOf(q.answer)];
                  const reasonText = q.explanation
                    ? q.explanation
                    : `Because this is a ${sectionFor(q.num).toLowerCase()} question, the correct choice is ${q.answer}) ${correctText}.`;
                  return (
                    <div className={`review-item ${wasCorrect ? 'right' : 'wrong'}`} key={q.num}>
                      <div className="ri-head">
                        <span>Q{q.num} · {sectionFor(q.num)}</span>
                        <span>{wasCorrect ? '✓ correct' : '✗ review'}</span>
                      </div>
                      <div className="ri-q">{q.text}</div>
                      {q.code ? (
                        <div className="q-code review-code">
                          <pre dangerouslySetInnerHTML={{ __html: highlightSQL(q.code) }} />
                        </div>
                      ) : null}
                      <div className="ri-ans">
                        <div className="review-row">
                          <span className="ri-label">Your answer:</span>
                          <span>{answer?.selected ? `${answer.selected}) ${yourText}` : 'Skipped'}</span>
                        </div>
                        <div className="review-row">
                          <span className="ri-label">Correct answer:</span>
                          <span>{q.answer}) {correctText}</span>
                        </div>
                        <div className="review-row reason">
                          <span className="ri-label">Reason:</span>
                          <span>{reasonText}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <div className="results-actions">
          <button className="btn primary" id="retry-btn" type="button" onClick={handleRetry}>
            ↻ Retake test
          </button>
          <button className="btn" id="retry-wrong-btn" type="button" onClick={handleRetryWrong}>
            Retry missed questions only
          </button>
          <button className="btn" id="print-report-btn" type="button" onClick={() => window.print()}>
            🖨 Print report
          </button>
        </div>
      </section>

      <footer className="foot">query_bench · local session, no data leaves your browser</footer>
    </div>
  );
}
