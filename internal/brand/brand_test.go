package brand

import "testing"

// TestText holds the rule every place that shows upstream magpie's prose
// relies on: the product's name becomes StallionX's, a command line
// becomes stallionx, and anything that is a name of something else (a
// path, file, host, link, identifier, template slot) is left alone.
func TestText(t *testing.T) {
	for _, c := range []struct{ in, want string }{
		{"", ""},
		{"no name here", "no name here"},
		{"magpie", "StallionX"},
		{"Magpie Browser", "StallionX Browser"},
		{"Requests your agents send through magpie show here.", "Requests your agents send through StallionX show here."},
		{"magpie's icon beside Omarchy's own", "StallionX's icon beside Omarchy's own"},
		{"magpie’s other models", "StallionX’s other models"},
		{"Keeps this computer awake while magpie runs tasks", "Keeps this computer awake while StallionX runs tasks"},
		{"Checks for a newer magpie by itself", "Checks for a newer StallionX by itself"},
		{"ends in magpie.", "ends in StallionX."},
		{"经 magpie 发出", "经 StallionX 发出"},
		{"magpie的设置", "StallionX的设置"},
		{"(magpie)", "(StallionX)"},
		{"“magpie”", "“StallionX”"},
		// the command line
		{"as magpie web does", "as stallionx web does"},
		{"run magpie daemon install", "run stallionx daemon install"},
		{"and magpie quota or accounts read them", "and stallionx quota or accounts read them"},
		{"A new terminal can't find the magpie command", "A new terminal can't find the stallionx command"},
		// prose, though a command shares the word
		{"the magpie app", "the StallionX app"},
		{"a magpie backup cut short", "a StallionX backup cut short"},
		// names of other things
		{"~/.config/magpie", "~/.config/magpie"},
		{"magpie.app", "magpie.app"},
		{"magpie.exe", "magpie.exe"},
		{"magpie://import?preset=x", "magpie://import?preset=x"},
		{"https://usemagpie.ai", "https://usemagpie.ai"},
		{"magpie-dev", "magpie-dev"},
		{"magpie_x", "magpie_x"},
		{"$magpie", "$magpie"},
		{"/v1/magpie/quotas", "/v1/magpie/quotas"},
		{"the {magpie} provider", "the {magpie} provider"},
		{"@magpie-community/opencode-x", "@magpie-community/opencode-x"},
		{"magpies", "magpies"},
		// two in a row
		{"magpie and magpie", "StallionX and StallionX"},
	} {
		if got := Text(c.in); got != c.want {
			t.Errorf("Text(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
