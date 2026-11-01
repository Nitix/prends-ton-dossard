// Package migrations holds the PocketBase schema migrations.
// Each migration registers itself in an init function and is picked up by a
// blank import of this package from the server entry point.
//
// # Naming
//
// PocketBase runs the migrations in the order of their file names, compared as
// strings (core/migrations_list.go), and records the ones it has applied by
// file name: a migration that is deployed is never renamed.
//
// The files 1_ to 9_ are the single digits. A file named with two digits would
// sort before them, because '0' is before '_': "10_x.go" runs before
// "1_collections.go", on any database that is created from scratch (a new
// install, the tests, the seed). So the next migrations are named after the 9,
// with a letter after the number, which sorts after "9_":
//
//	9a_<name>.go, 9b_<name>.go, ... 9z_<name>.go
//
// Letters go on past 9z the same way (9za_, 9zb_, ...): the order is the number,
// then the letters as a string. Never two digits, never a capital letter.
// TestMigrationNames_FollowTheIntendedOrder fails when a name breaks the rule.
package migrations
