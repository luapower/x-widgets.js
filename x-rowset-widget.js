
// ---------------------------------------------------------------------------
// rowset_widget mixin
// ---------------------------------------------------------------------------

/*
	rowset widgets must implement:
		update()
		update_cell_state(ri, fi, prop, val, ev)
		update_row_state(ri, prop, val, ev)
		update_cell_editing(ri, [fi], editing)
		scroll_to_cell(ri, [fi])
*/

function rowset_widget(e) {

	e.can_edit = true
	e.can_add_rows = true
	e.can_remove_rows = true
	e.can_change_rows = true

	e.can_focus_cells = true         // can focus individual cells vs entire rows.
	e.auto_focus_first_cell = true   // focus first cell automatically on loading.
	e.auto_edit_first_cell = false   // automatically enter edit mode on loading.
	e.stay_in_edit_mode = true       // re-enter edit mode after navigating
	e.auto_advance_row = true        // jump row on horiz. navigation limits
	e.save_row_on = 'exit_edit'      // save row on 'input'|'exit_edit'|'exit_row'|false
	e.insert_row_on = 'exit_edit'    // insert row on 'input'|'exit_edit'|'exit_row'|false
	e.remove_row_on = 'input'        // remove row on 'input'|'exit_row'|false
	e.can_exit_edit_on_errors = true // allow exiting edit mode on validation errors
	e.can_exit_row_on_errors = false // allow changing row on validation errors
	e.exit_edit_on_lost_focus = false // exit edit mode when losing focus
	e.multiple_selection = true
	e.can_select_non_siblings = true

	// prop('can_edit'               , {type: 'bool'})
	// prop('can_add_rows'           , {type: 'bool'})
	// prop('can_remove_rows'        , {type: 'bool'})
	// prop('can_change_rows'        , {type: 'bool'})
	// prop('can_focus_cells'        , {type: 'bool'})
	// prop('auto_focus_first_cell'  , {type: 'bool'})
	// prop('auto_edit_first_cell'   , {type: 'bool'})
	// prop('auto_advance_row'       , {type: 'bool'})
	// prop('save_row_on'            , {type: 'enum', enum_values: ['input', 'exit_edit', 'exit_row', false]})
	// prop('insert_row_on'          , {type: 'enum', enum_values: ['input', 'exit_edit', 'exit_row', false]})
	// prop('remove_row_on'          , {type: 'enum', enum_values: ['input', 'exit_row', false]})
	// prop('can_exit_edit_on_errors', {type: 'bool'})
	// prop('can_exit_row_on_errors' , {type: 'bool'})
	// prop('exit_edit_on_lost_focus', {type: 'bool'})

	//val_widget(e)

	// rowset binding ---------------------------------------------------------

	function bind_rowset(rs, on) {
		if (!rs) return
		// structural changes
		rs.on('loaded'      , rowset_loaded , on)
		rs.on('row_added'   , row_added     , on)
		rs.on('row_removed' , row_removed   , on)
		// state changes
		rs.on('row_state_changed'    , row_state_changed    , on)
		rs.on('cell_state_changed'   , cell_state_changed   , on)
		rs.on('display_vals_changed' , display_vals_changed , on)
		// network events
		rs.on('loading'       , rowset_loading       , on)
		rs.on('load_slow'     , rowset_load_slow     , on)
		rs.on('load_progress' , rowset_load_progress , on)
		rs.on('load_fail'     , rowset_load_fail     , on)
		// misc.
		rs.on('notify', e.notify, on)
		// take/release ownership of the rowset.
		rs.bind_user_widget(e, on)
	}

	e.on('attach', function() {
		bind_rowset(rs, true)
		update_all({fields: true, rows: true, refocus: 'first'})
	})

	e.on('detach', function() {
		bind_rowset(rs, false)
		update_all({fields: true, rows: true, refocus: 'none'})
	})

	function set_rowset(rs1) {
		let rs0 = rs
		rs = rs1
		if (e.attached) {
			bind_rowset(rs0, false)
			bind_rowset(rs1, true)
		}
		update_all({fields: true, rows: true, refocus: 'first'})
		e.fire('rowset_changed', rs1, rs0)
	}
	let rs = null
	e.property('rowset', () => rs, set_rowset)

	e.prop('rowset_name', {store: 'var', bind: 'rowset', resolve: global_rowset})

	// row -> row_index mapping -----------------------------------------------

	let rowmap = new Map()

	e.row_index = function(row, ri) {
		if (!row)
			return null
		if (ri != null && ri != false)
			return ri
		if (row == e.focused_row) // most likely true (avoid making a rowmap).
			return e.focused_row_index
		if (!rowmap.size) {
			for (let i = 0; i < e.rows.length; i++) {
				rowmap.set(e.rows[i], i)
			}
		}
		return rowmap.get(row)
	}

	// field -> field_index mapping -------------------------------------------

	let fieldmap = new Map

	e.field_index = function(field, fi) {
		if (!field)
			return null
		if (fi != null && fi != false)
			return fi
		if (field == e.focused_field) // most likely true (avoid maiking a fieldmap).
			return e.focused_field_index
		if (!fieldmap.size) {
			for (let i = 0; i < e.fields.length; i++) {
				fieldmap.set(e.fields[i], i)
			}
		}
		return fieldmap.get(field)
	}

	// updating the internal model amd view -----------------------------------

	e.fields = null
	e.rows = null
	e.focused_row_index = null
	e.focused_field_index = null

	function update_all(opt) {

		let was_editing = !!e.editor
		let focus_editor = e.editor && e.editor.hasfocus

		let focused_row, focused_pk
		if (opt.refocus) {
			if (opt.refocus == 'same_row')
				focused_row = e.focused_row
			else if (opt.refocus == 'same_pk') {
				let row = e.focused_row
				focused_pk = e.rowset.pk_fields.map((field) => e.rowset.val(row, field))
			} else
				e.focus_cell(false, false, 0, 0, {force_exit_edit: true})
		}

		e.update_load_fail(false)
		unbind_filter_rowsets()

		if (opt.fields) {
			fieldmap.clear()
			if (rs && e.attached) {
				e.fields = []
				e.val_field = rs.field(e.val_col)
				e.tree_field = rs.field(e.tree_col)
				if (e.cols) {
					for (let col of e.cols.split(' ')) {
						let field = rs.field(col)
						if (field && field.visible != false)
							e.fields.push(field)
					}
				} else {
					for (let field of rs.fields)
						if (field.visible != false)
							e.fields.push(field)
				}
			} else
				e.fields = null
		}

		if (opt.rows || opt.sort) {
			rowmap.clear()
			clear_selection()
			if (rs && e.attached) {
				let initial_order = !(rs.parent_field || order_by.size)
				if (opt.rows || initial_order) {
					e.rows = []
					let i = 0
					let passes = rs.filter_rowsets_filter(e.filter_rowsets)
					for (let row of rs.rows)
						if (!row.parent_collapsed && passes(row))
							e.rows.push(row)
				}
				if (!initial_order) {
					let cmp = rs.comparator(order_by)
					e.rows.sort(cmp)
				}
			} else
				e.rows = null
		}

		e.update({
			fields: opt.fields,
			rows: opt.rows,
			row_contents: opt.row_contents || opt.sort,
			sort_order: opt.sort,
			focus: opt.focus,
		})

		if (rs && e.attached) {
			if (focused_pk)
				focused_row = e.rowset.lookup(e.pk_fields, focused_pk)
			if (focused_row) {
				e.focused_row_index = e.row_index(focused_row)
				e.update({focus: true})
			} else if (opt.refocus == 'first')
				e.focus_cell(true, true, 0, 0, {
					must_not_move_row: !e.auto_focus_first_cell,
					enter_edit: e.auto_edit_first_cell,
					was_editing: was_editing,
					focus_editor: focus_editor,
				})
		}

	}

	// changing field visibility ----------------------------------------------

	e.show_field = function(field, at_fi, on) {
		if (on)
			if (at_fi != null)
				e.fields.insert(at_fi, field)
			else
				e.fields.push(field)
		else
			e.fields.remove_value(field)
		fieldmap.clear()
		update_all({fields: true})
	}

	// adding & removing rows -------------------------------------------------

	e.insert_row = function(at_focused_row, focus_it, ev) {
		if (!e.can_edit || !e.can_add_rows)
			return false
		let at_row = at_focused_row && e.focused_row
		let parent_row = at_row ? at_row.parent_row : null
		let row = rs.add_row(update({
			row_index: at_row && e.focused_row_index,
			focus_it: focus_it,
			parent_row: parent_row,
		}, ev))
		if (row && e.save_row_on && e.insert_row_on == 'input')
			e.save(row)
		return row
	}

	e.remove_row = function(ri, ev) {
		if (!e.can_edit || !e.can_remove_rows)
			return false
		let row = rs.remove_row(e.rows[ri], update({
			row_index: ri,
		}, ev))
		if (e.save_row_on && e.remove_row_on == 'input')
			e.save(row)
		return row
	}

	e.remove_focused_row = function(ev) {
		if (e.focused_row)
			return e.remove_row(e.focused_row_index, ev)
	}

	// responding to structural updates ---------------------------------------

	function rowset_loaded(fields_changed) {
		update_all({rows: true, refocus: 'same_pk', fields: fields_changed})
	}

	function row_added(row, ev) {
		let ri = ev && ev.row_index
		if (ri != null) {
			e.rows.insert(ri, row)
			if (e.focused_row_index >= ri)
				e.focused_row_index++
		} else
			ri = e.rows.push(row)
		rowmap.clear()
		e.update({rows: true})
		if (ev && ev.focus_it)
			e.focus_cell(ri, true, 0, 0, ev)
	}

	function row_removed(row, ev) {
		let ri = e.row_index(row, ev && ev.row_index)
		let n = 1
		if (row.parent_rows) {
			let min_parent_rows = row.parent_rows.length + 1
			while (1) {
				let row = e.rows[ri + n]
				if (!row || row.parent_rows.length < min_parent_rows)
					break
				n++
			}
		}
		e.rows.splice(ri, n)
		rowmap.clear()
		e.update({rows: true})
		if (ev && ev.refocus)
			if (!e.focus_cell(ri, true, 0, 0, ev))
				e.focus_cell(ri, true, -0, 0, ev)
	}

	// responding to cell updates ---------------------------------------------

	function row_state_changed(row, prop, val, ev) {
		let ri = e.row_index(row, ev && ev.row_index)
		e.update_row_state(ri, prop, val, ev)
		if (row == e.focused_row) {
			e.fire('focused_row_state_changed', prop, val, ev)
			e.fire('focused_row_'+prop+'_changed', val, ev)
		}
	}

	function cell_state_changed(row, field, prop, val, ev) {
		let ri = e.row_index(row, ev && ev.row_index)
		let fi = e.field_index(field, ev && ev.field_index)
		if (fi == null)
			return
		e.update_cell_state(ri, fi, prop, val, ev)
		if (row == e.focused_row) {
			e.fire('focused_row_cell_state_changed_for_'+field.name, prop, val, ev)
			e.fire('focused_row_'+prop+'_changed_for_'+field.name, val, ev)
		}
	}

	function display_vals_changed(field) {
		e.update({row_contents: true})
	}

	// responding to notifications from rowset --------------------------------

	e.notify = function(type, message) {
		notify(message, type)
	}

	e.update_loading = function(on) { // stub
		if (!on) return
		e.load_overlay(true)
	}

	function rowset_loading(on) {
		e.class('loading', on)
		e.update_loading(on)
		e.update_load_progress(0)
	}

	e.update_load_progress = noop // stub

	function rowset_load_progress(p) {
		e.update_load_progress(p)
	}

	e.update_load_slow = function(on) { // stub
		if (on)
			e.load_overlay(true, 'waiting',
				S('slow', 'Still working on it...'),
				S('stop_waiting', 'Stop waiting'))
		else
			e.load_overlay(true, 'waiting',
				S('loading', 'Loading...'),
				S('stop_loading', 'Stop loading'))
	}

	function rowset_load_slow(on) {
		e.update_load_slow(on)
	}

	e.update_load_fail = function(on, error, type, status, message, body) {
		if (!e.attached)
			return
		if (type == 'abort')
			e.load_overlay(false)
		else
			e.load_overlay(on, 'error', error, null, body)
	}

	function rowset_load_fail(...args) {
		e.update_load_fail(true, ...args)
	}

	// loading overlay --------------------------------------------------------

	{
	let oe
	e.load_overlay = function(on, cls, text, cancel_text, detail) {
		if (oe) {
			oe.remove()
			oe = null
		}
		e.disabled = on
		e.class('disabled', e.disabled)
		if (!on)
			return
		oe = overlay({class: 'x-loading-overlay'})
		oe.content.class('x-loading-overlay-message')
		if (cls)
			oe.class(cls)
		let focus_e
		if (cls == 'error') {
			let more_div = div({class: 'x-loading-overlay-detail'})
			let band = action_band({
				layout: 'more... less... < > retry:ok forget-it:cancel',
				buttons: {
					more: function() {
						more_div.set(detail, 'pre-wrap')
						band.at[0].hide()
						band.at[1].show()
					},
					less: function() {
						more_div.clear()
						band.at[0].show()
						band.at[1].hide()
					},
					retry: function() {
						e.load_overlay(false)
						rs.reload()
					},
					forget_it: function() {
						e.load_overlay(false)
					},
				},
			})
			band.at[1].hide()
			let error_icon = span({class: 'x-loading-error-icon fa fa-exclamation-circle'})
			oe.content.add(div({}, error_icon, text, more_div, band))
			focus_e = band.last.prev
		} else if (cls == 'waiting') {
			let cancel = button({
				text: cancel_text,
				action: function() {
					rs.abort_loading()
				},
				attrs: {style: 'margin-left: 1em;'},
			})
			oe.content.add(text, cancel)
			focus_e = cancel
		} else
			oe.content.remove()
		e.add(oe)
		if(focus_e && e.hasfocus)
			focus_e.focus()
	}
	}

	// navigation and selection -----------------------------------------------

	e.can_change_val = function(row, field) {
		return e.can_edit && e.can_change_rows
			&& rs.can_change_val(row, field)
	}

	e.is_cell_disabled = function(row, field) {
		return !rs.can_focus_cell(row, field)
	}

	e.can_focus_cell = function(row, field, for_editing) {
		return (field == null || e.can_focus_cells)
			&& rs.can_focus_cell(row, field)
			&& (!for_editing || e.can_change_val(row, field))
	}

	e.can_select_cell = function(row, field, for_editing) {
		return e.can_focus_cell(row, field, for_editing)
			&& (e.can_select_non_siblings
				|| e.selected_rows.size == 0
				|| row.parent_row == e.selected_rows.keys().next().value.parent_row)
	}

	e.property('focused_row', function() {
		return e.rows[e.focused_row_index]
	})

	e.property('focused_field', function() {
		return e.fields[e.focused_field_index]
	})

	e.property('selected_row', function() {
		return e.rows[e.selected_row_index]
	})

	e.property('selected_field', function() {
		return e.fields[e.selected_field_index]
	})

	e.first_focusable_cell = function(ri, fi, rows, cols, options) {

		if (!e.rows)
			return [null, null]

		if (ri === true) ri = e.focused_row_index
		if (fi === true) fi = e.field_index(rs.field(e.focused_field_name))
		rows = or(rows, 0) // by default find the first focusable row.
		cols = or(cols, 0) // by default find the first focusable col.

		let editable = options && options.editable // skip non-editable cells.
		let must_move = options && options.must_move // return only if moved.
		let must_not_move_row = options && options.must_not_move_row // return only if row not moved.
		let must_not_move_col = options && options.must_not_move_col // return only if col not moved.

		let ri_inc = strict_sign(rows)
		let fi_inc = strict_sign(cols)
		rows = abs(rows)
		cols = abs(cols)

		// if starting from nowhere, include the first/last row/col into the count.
		if (ri == null && rows)
			rows--
		if (fi == null && cols)
			cols--

		let move_row = rows >= 1
		let move_col = cols >= 1
		let start_ri = ri
		let start_fi = fi

		// the default cell is the first or the last depending on direction.
		ri = or(ri, ri_inc * -1/0)
		fi = or(fi, fi_inc * -1/0)

		// clamp out-of-bound row/col indices.
		ri = clamp(ri, 0, e.rows.length-1)
		fi = clamp(fi, 0, e.fields.length-1)

		let last_valid_ri = null
		let last_valid_fi = null
		let last_valid_row

		// find the last valid row, stopping after the specified row count.
		if (e.can_focus_cell(null, null, editable))
			while (ri >= 0 && ri < e.rows.length) {
				let row = e.rows[ri]
				if (e.can_focus_cell(row, null, editable)) {
					last_valid_ri = ri
					last_valid_row = row
					if (rows <= 0)
						break
				}
				rows--
				ri += ri_inc
			}

		if (last_valid_ri == null)
			return [null, null]

		// if wanted to move the row but couldn't, don't move the col either.
		let row_moved = last_valid_ri != start_ri
		if (move_row && !row_moved)
			cols = 0

		while (fi >= 0 && fi < e.fields.length) {
			let field = e.fields[fi]
			if (e.can_focus_cell(last_valid_row, field, editable)) {4
				last_valid_fi = fi
				if (cols <= 0)
					break
			}
			cols--
			fi += fi_inc
		}

		let col_moved = last_valid_fi != start_fi

		if (must_move && !(row_moved || col_moved))
			return [null, null]

		if ((must_not_move_row && row_moved) || (must_not_move_col && col_moved))
			return [null, null]

		return [last_valid_ri, last_valid_fi]
	}

	e.focus_cell = function(ri, fi, rows, cols, ev) {

		if (ri === false || fi === false) // false means unfocus.
			return e.focus_cell(
				ri === false ? null : ri,
				fi === false ? null : fi, 0, 0,
				update({
					must_not_move_row: ri === false,
					must_not_move_col: fi === false,
					unfocus_if_not_found: true,
				}, ev)
			)

		let was_editing = (ev && ev.was_editing) || !!e.editor
		let focus_editor = (ev && ev.focus_editor) || (e.editor && e.editor.hasfocus)
		let enter_edit = (ev && ev.enter_edit) || (was_editing && e.stay_in_edit_mode)
		let editable = (ev && ev.editable) || enter_edit
		let force_exit_edit = (ev && ev.force_exit_edit)
		let expand_selection = ev && ev.expand_selection && e.multiple_selection
		let invert_selection = ev && ev.invert_selection && e.multiple_selection

		let opt = update({editable: editable}, ev)
		;[ri, fi] = e.first_focusable_cell(ri, fi, rows, cols, opt)

		if (ri == null) // failure to find row means cancel.
			if (!(ev && ev.unfocus_if_not_found))
				return false

		let row_changed = e.focused_row_index != ri
		let field_changed = e.focused_field_index != fi

		if (row_changed) {
			if (!e.exit_focused_row(force_exit_edit))
				return false
		} else if (field_changed) {
			if (!e.exit_edit(force_exit_edit))
				return false
		}

		let last_ri = e.focused_row_index
		let last_fi = e.focused_field_index
		let ri0 = or(e.selected_row_index  , last_ri)
		let fi0 = or(e.selected_field_index, last_fi)
		let row0 = e.focused_row

		e.focused_row_index   = ri
		e.focused_field_index = fi
		if (fi != null)
			e.focused_field_name = e.fields[fi].name

		let row = e.rows[ri]

		// TODO: value widget
		// let val = row && e.val_field ? rs.val(row, e.val_field) : null
		// e.set_val(val, update({input: e}, ev))

		let sel_rows_changed
		if (ev && ev.selected_rows) {
			e.selected_rows = new Map(ev.selected_rows)
			sel_rows_changed = true
		} else if (e.can_focus_cells) {
			if (expand_selection) {
				let ri1 = min(ri0, ri)
				let ri2 = max(ri0, ri)
				let fi1 = min(fi0, fi)
				let fi2 = max(fi0, fi)
				for (let ri = ri1; ri <= ri2; ri++) {
					let row = e.rows[ri]
					if (e.can_select_cell(row)) {
						let a = e.selected_rows.get(row) || []
						for (let fi = fi1; fi <= fi2; fi++)
							if (e.can_select_cell(row, e.fields[fi])) {
								if (!a[fi]) {
									a[fi] = true
									sel_rows_changed = true
								}
							}
						if (a.length)
							e.selected_rows.set(row, a)
						else
							e.selected_rows.delete(row)
					}
				}
			} else {
				let a = e.selected_rows.get(row) || []
				if (!invert_selection) {
					e.selected_rows.clear()
					a = []
				}
				a[fi] = !a[fi]
				let n = 0; a.map(t => n += t)
				if (n && row)
					e.selected_rows.set(row, a)
				else
					e.selected_rows.delete(row)
				sel_rows_changed = true
			}
		} else {
			if (expand_selection) {
				let ri1 = min(ri0, ri)
				let ri2 = max(ri0, ri)
				for (let ri = ri1; ri <= ri2; ri++) {
					let row = e.rows[ri]
					if (!e.selected_rows.has(row)) {
						if (e.can_select_cell(row)) {
							e.selected_rows.set(row, true)
							sel_rows_changed = true
						}
					}
				}
			} else {
				if (!invert_selection)
					e.selected_rows.clear()
				if (row)
					if (e.selected_rows.has(row))
						e.selected_rows.delete(row)
					else
						e.selected_rows.set(row, true)
				sel_rows_changed = true
			}
		}

		e.selected_row_index   = expand_selection ? ri0 : null
		e.selected_field_index = expand_selection ? fi0 : null

		if (row_changed)
			e.fire('focused_row_changed', row, row0, ev)

		if (sel_rows_changed)
			e.fire('selected_rows_changed')

		if (row_changed || sel_rows_changed || field_changed)
			e.update({focus: true})

		if (enter_edit && ri != null && fi != null)
			e.enter_edit(ev && ev.editor_state, focus_editor || false)

		if (!(ev && ev.make_visible == false))
			if (e.focused_row_index != null)
				e.scroll_to_cell(e.focused_row_index, e.focused_cell_index)

		return true
	}

	e.focus_next_cell = function(cols, ev) {
		let dir = strict_sign(cols)
		let auto_advance_row = ev && ev.auto_advance_row || e.auto_advance_row
		return e.focus_cell(true, true, dir * 0, cols, update({must_move: true}, ev))
			|| (auto_advance_row && e.focus_cell(true, true, dir, dir * -1/0, ev))
	}

	e.is_last_row_focused = function() {
		let [ri] = e.first_focusable_cell(true, true, 1, 0, {must_move: true})
		return ri == null
	}

	e.selected_rows = new Map()

	function clear_selection() {
		e.selected_row_index   = null
		e.selected_field_index = null
		e.selected_rows.clear()
	}

	function reset_selection() {
		let sel_rows_size_before = e.selected_rows.size
		clear_selection()
		if (e.focused_row) {
			let a = true
			if (e.can_focus_cells && e.focused_field) {
				a = []
				a[e.focused_field_index] = true
			}
			e.selected_rows.set(e.focused_row, a)
		}
		if (sel_rows_size_before)
			e.fire('selected_rows_changed')
	}

	e.select_all = function() {
		let sel_rows_size_before = e.selected_rows.size
		e.selected_rows.clear()
		for (let row of e.rows)
			if (e.can_select_cell(row)) {
				let a = true
				if (e.can_focus_cells) {
					a = []
					for (let fi = 0; fi < e.fields.length; fi++)
						if (e.can_select_cell(row, e.fields[fi]))
							a[fi] = true
				}
				e.selected_rows.set(row, a)
			}
		e.update({focus: true})
		if (sel_rows_size_before != e.selected_rows.size)
			e.fire('selected_rows_changed')
	}

	e.is_row_selected = function(row) {
		return e.selected_rows.has(row)
	}

	// responding to val changes ----------------------------------------------

	e.update_val = function(v, ev) {
		if (ev && ev.input == e)
			return // coming from focus_cell(), avoid recursion.
		if (!e.val_field)
			return // fields not initialized yet.
		let row = rs.lookup(e.val_field, v)
		let ri = e.row_index(row)
		e.focus_cell(ri, true, 0, 0,
			update({must_not_move_row: true, unfocus_if_not_found: true}, ev))
	}

	// editing ----------------------------------------------------------------

	e.editor = null

	e.create_editor = function(field, ...editor_options) {
		return rs.create_editor(field, {
			nav: e,
			col: field.name,
		}, ...editor_options)
	}

	e.enter_edit = function(editor_state, focus) {
		if (e.editor)
			return true
		if (!e.can_focus_cell(e.focused_row, e.focused_field, true))
			return false
		e.editor = e.create_editor(e.focused_field)
		if (!e.editor)
			return false
		e.update_cell_editing(e.focused_row_index, e.focused_field_index, true)
		e.editor.on('lost_focus', editor_lost_focus)
		if (e.editor.enter_editor)
			e.editor.enter_editor(editor_state)
		if (focus != false)
			e.editor.focus()
		return true
	}

	function free_editor() {
		let editor = e.editor
		if (editor) {
			e.editor = null // removing the editor first as a barrier for lost_focus().
			editor.remove()
		}
	}

	e.exit_edit = function(force) {
		if (!e.editor)
			return true

		if (!force)
			if (!e.can_exit_edit_on_errors && rs.row_has_errors(e.focused_row))
				return false

		if (!e.fire('exit_edit', e.focused_row_index, e.focused_field_index, force))
			if (!force)
				return false

		if (e.save_row_on == 'exit_edit')
			e.save(e.focused_row)

		if (!force)
			if (!e.can_exit_row_on_errors && rs.row_has_errors(e.focused_row))
				return false

		let had_focus = e.hasfocus
		free_editor()
		e.update_cell_editing(e.focused_row_index, e.focused_field_index, false)
		if (had_focus)
			e.focus()

		return true
	}

	function editor_lost_focus(ev) {
		if (!e.editor) // editor is being removed.
			return
		if (ev.target != e.editor) // other input that bubbled up.
			return
		if (e.exit_edit_on_lost_focus)
			e.exit_edit()
	}

	e.exit_focused_row = function(force) {
		let row = e.focused_row
		if (!row)
			return true
		if (!e.exit_edit(force))
			return false
		if (row.cells_modified) {
			let err = rs.validate_row(row)
			rs.set_row_error(row, err)
		}
		if (!force)
			if (!e.can_exit_row_on_errors && rs.row_has_errors(row))
				return false
		if (e.save_row_on == 'exit_row'
			|| (e.save_row_on && row.is_new  && e.insert_row_on == 'exit_row')
			|| (e.save_row_on && row.removed && e.remove_row_on == 'exit_row')
		) {
			e.save(row)
		}
		return true
	}

	e.save = function(row) {
		rs.save(row)
	}

	// changing the sort order ------------------------------------------------

	let order_by = new Map()

	e.late_property('order_by',
		function() {
			let a = []
			for (let [field, dir] of order_by) {
				a.push(field.name + (dir == 'asc' ? '' : ' desc'))
			}
			return a.join(', ')
		},
		function(s) {
			order_by.clear()
			for (let s1 of s.split(/\s+/)) {
				let m = s1.split(':')
				let name = m[0]
				let field = rs.field(name)
				if (field && field.sortable) {
					let dir = m[1] || 'asc'
					if (dir == 'asc' || dir == 'desc')
						order_by.set(field, dir)
				}
			}
			e.sort()
		}
	)

	e.order_by_priority = function(field) {
		let i = order_by.size-1
		for (let [field1] of order_by) {
			if (field1 == field)
				return i
			i--
		}
	}

	e.order_by_dir = function(field) {
		return order_by.get(field)
	}

	e.set_order_by_dir = function(field, dir, keep_others) {
		if (!field.sortable)
			return
		if (dir == 'toggle') {
			dir = order_by.get(field)
			dir = dir == 'asc' ? 'desc' : (dir == 'desc' ? false : 'asc')
		}
		if (!keep_others)
			order_by.clear()
		if (dir)
			order_by.set(field, dir)
		else
			order_by.delete(field)
		update_all({sort: true, refocus: 'same_row'})
	}

	e.clear_order = function() {
		order_by.clear()
		update_all({sort: true, refocus: 'same_row'})
	}

	// row collapsing ---------------------------------------------------------

	e.set_collapsed = function(ri, collapsed, recursive) {
		if (ri != null)
			rs.set_collapsed(e.rows[ri], collapsed, recursive)
		else
			for (let row of rs.child_rows)
				rs.set_collapsed(row, collapsed, recursive)
		update_all({rows: true})
	}

	e.toggle_collapsed = function(ri, recursive) {
		e.set_collapsed(ri, !e.rows[ri].collapsed, recursive)
	}

	// row moving -------------------------------------------------------------

	e.child_row_count = function(ri) {
		let n = 0
		if (rs.parent_field) {
			let row = e.rows[ri]
			let min_parent_count = row.parent_rows.length + 1
			for (ri++; ri < e.rows.length; ri++) {
				let child_row = e.rows[ri]
				if (child_row.parent_rows.length < min_parent_count)
					break
				n++
			}
		}
		return n
	}

	function reset_indices_for_children_of(row) {
		let index = 1
		let min_parent_count = row ? row.parent_rows.length + 1 : 0
		for (let ri = row ? e.row_index(row) + 1 : 0; ri < e.rows.length; ri++) {
			let child_row = e.rows[ri]
			if (child_row.parent_rows.length < min_parent_count)
				break
			if (child_row.parent_row == row)
				rs.set_val(child_row, rs.index_field, index++)
		}
	}

	e.move_row = function(moved_rows, over_ri, parent_row) {

		e.rows.splice(over_ri, 0, ...moved_rows)
		rowmap.clear()

		let row = moved_rows[0]
		let old_parent_row = row.parent_row
		rs.move_row(row, parent_row)

		if (rs.index_field)
			if (rs.parent_field) {
				reset_indices_for_children_of(old_parent_row)
				if (parent_row != old_parent_row)
					reset_indices_for_children_of(parent_row)
			} else {
				let index = 1
				for (let ri = 0; ri < e.rows.length; ri++)
					rs.set_val(e.rows[ri], rs.index_field, index++)
			}

	}

	// filtering --------------------------------------------------------------

	function unbind_filter_rowsets() {
		if (!e.filter_rowsets)
			return
		for (let [field, rs] of e.filter_rowsets) {
			//TODO: rs.unbind()
		}
		e.filter_rowsets = null
	}

	e.filter_rowset = function(field) {
		e.filter_rowsets = e.filter_rowsets || new Map()
		let frs = e.filter_rowsets.get(field)
		if (!frs) {
			frs = rs.filter_rowset(field, {
				field_attrs: {'0': {w: 20}},
			})
			e.filter_rowsets.set(field, frs)
		}
		return rs
	}

	// crude quick-search only for the first letter ---------------------------

	let found_row_index
	function quicksearch(c, field, again) {
		if (e.focused_row_index != found_row_index)
			found_row_index = null // user changed selection, start over.
		let ri = found_row_index != null ? found_row_index+1 : 0
		if (ri >= e.rows.length)
			ri = null
		while (ri != null) {
			let s = rs.display_val(e.rows[ri], field)
			if (s.starts(c.lower()) || s.starts(c.upper())) {
				e.focus_cell(ri, true, 0, 0, {input: e})
				break
			}
			ri++
			if (ri >= e.rows.length)
				ri = null
		}
		found_row_index = ri
		if (found_row_index == null && !again)
			quicksearch(c, field, true)
	}

	e.quicksearch = function(c, field) {
		field = field
			||	e.quicksearch_field
			|| (e.quicksearch_col && rs.field(e.quicksearch_col))
		if (field)
			quicksearch(c, field)
	}

	// picker protocol --------------------------------------------------------

	e.pick_near_val = function(delta, ev) {
		if (e.focus_cell(true, true, delta, 0, ev))
			e.fire('val_picked', ev)
	}

}

