package review

import (
	"time"

	"github.com/open-spaced-repetition/go-fsrs/v3"
)

// again is state after a failed recall at at. A zero state is a word never
// scheduled. The scheduler runs go-fsrs's default parameters without its
// short-term steps: intervals are whole days.
func again(state State, at time.Time) State {
	return schedule(state, at, RatingAgain)
}

// schedule is state after rating at at. A zero state is a word never
// scheduled. Default FSRS parameters, short-term steps off.
func schedule(state State, at time.Time, rating Rating) State {
	params := fsrs.DefaultParam()
	params.EnableShortTerm = false
	card := fsrs.NewCard()
	if state.Reps > 0 {
		card.Stability = state.Stability
		card.Difficulty = state.Difficulty
		card.State = fsrs.State(state.Phase)
		card.Due = state.Due
		card.LastReview = state.LastReview
		card.Reps = uint64(state.Reps)
	}
	// One FSRS per call: Next writes to its parameters.
	next := fsrs.NewFSRS(params).Next(card, at, fsrsRating(rating)).Card

	state.Stability = next.Stability
	state.Difficulty = next.Difficulty
	state.Phase = int(next.State)
	state.Due = next.Due
	state.LastReview = at
	state.Reps = int(next.Reps)
	return state
}

func fsrsRating(rating Rating) fsrs.Rating {
	switch rating {
	case RatingHard:
		return fsrs.Hard
	case RatingGood:
		return fsrs.Good
	case RatingEasy:
		return fsrs.Easy
	default:
		return fsrs.Again
	}
}
