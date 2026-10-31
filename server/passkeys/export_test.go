package passkeys

// Len returns the number of sessions kept, expired ones included.
func (s *Sessions) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}
