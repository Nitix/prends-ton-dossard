package weather

// Label is the French words of a WMO weather code (spec § 10.6).
func Label(code int) string {
	switch code {
	case 0:
		return "Ciel dégagé"
	case 1, 2:
		return "Peu nuageux"
	case 3:
		return "Couvert"
	case 45, 48:
		return "Brouillard"
	case 51, 53, 55, 56, 57:
		return "Bruine"
	case 61, 63:
		return "Pluie"
	case 65:
		return "Forte pluie"
	case 66, 67:
		return "Pluie verglaçante"
	case 71, 73, 75, 77:
		return "Neige"
	case 80, 81:
		return "Averses"
	case 82:
		return "Fortes averses"
	case 85, 86:
		return "Averses de neige"
	case 95:
		return "Orage"
	case 96, 99:
		return "Orage et grêle"
	}
	return "Temps inconnu"
}
