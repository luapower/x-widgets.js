/*

	X-WIDGETS: Data-driven web components in JavaScript.
	Written by Cosmin Apreutesei. Public Domain.

*/

// ---------------------------------------------------------------------------
// rowset
// ---------------------------------------------------------------------------

/*
	rowset.types : {type -> {attr->val}}

	d.fields: [{attr->val}, ...]
		name           : field name (defaults to field numeric index)
		type           : for choosing a field template.
		client_default : default value that new rows are initialized with.
		server_default : default value that the server sets.
		allow_null     : allow null (true).
		editable       : allow modifying (true).
		sortable       : allow sorting (true).
		validate       : f(v, field) -> true|err
		format         : f(v, field) -> s
		align          : 'left'|'right'|'center'
		editor         : f(field) -> editor
		compare_types  : f(v1, v2) -> -1|0|1
		compare_values : f(v1, v2) -> -1|0|1

	d.rows: [{attr->val}, ...]
		values         : [v1,...]
		is_new         : new row, not added on server yet.
		removed        : removed row, not removed on server yet.
		original_values: original values on an updated but not yet saved row.

	^d.value_changed(row, field, val)
	^d.row_added(ri)
	^d.row_removed(ri)

	d.add_row()
	d.remove_row()

*/

let rowset = function(...options) {

	let d = {}

	d.can_edit        = true
	d.can_add_rows    = true
	d.can_remove_rows = true
	d.can_change_rows = true

	let fields // [fi: {name:, client_default: v, server_default: v, ...}]
	let rows   // [ri: row]; row = {values: [fi: val], attr: val, ...}
	let field_map = new Map()

	install_events(d)

	let init = function() {

		// set options/override.
		update(d, rowset, ...options)

		d.fields = d.fields || []
		d.rows = d.rows || []

		// init locals.
		fields = d.fields
		rows = d.rows

		for (let i = 0; i < d.fields.length; i++) {
			let f1 = d.fields[i]
			let f0 = f1.type ? (d.types[f1.type] || rowset.types[f1.type]) : null
			let field = update({index: i}, rowset.default_type, d.default_type, f0, f1)
			fields[i] = field
			field_map.set(field.name || i, field)
		}

	}

	d.field = function(name) {
		return field_map.get(name)
	}

	// get/set row values -----------------------------------------------------

	d.value = function(row, field) {
		let get_value = field.get_value // computed value?
		return get_value ? get_value(field, row, fields) : row.values[field.index]
	}

	d.display_value = function(row, field) {
		return field.format.call(d, d.value(row, field), field)
	}

	d.validate_value = function(field, val) {
		if (val === '' || val == null)
			return field.allow_null || 'NULL not allowed'
		let validate = field.validate
		if (!validate)
			return true
		return validate.call(d, val, field)
	}

	d.validate_row = return_true // stub

	d.compare_rows = function(row1, row2) {
		// invalid rows come first.
		if (row1.invalid != row2.invalid)
			return row1.invalid ? -1 : 1
		return 0
	}

	d.compare_types = function(v1, v2) {
		// nulls come first.
		if ((v1 === null) != (v2 === null))
			return v1 === null ? -1 : 1
		// NaNs come second.
		if ((v1 !== v1) != (v2 !== v2))
			return v1 !== v1 ? -1 : 1
		return 0
	}

	d.compare_values = function(v1, v2) {
		return v1 !== v2 ? (v1 < v2 ? -1 : 1) : 0
	}

	d.comparator = function(field) {

		var compare_rows = d.compare_rows
		var compare_types  = field.compare_types  || d.compare_types
		var compare_values = field.compare_values || d.compare_values
		var field_index = field.index

		return function (row1, row2) {
			var r = compare_rows(row1, row2)
			if (r) return r

			let v1 = row1.values[field_index]
			let v2 = row2.values[field_index]

			var r = compare_types(v1, v2)
			if (r) return r

			return compare_values(v1, v2)
		}
	}

	d.can_focus_cell = function(row, field) {
		return row.focusable != false && (field == null || field.focusable != false)
	}

	d.can_change_value = function(row, field) {
		return d.can_edit && d.can_change_rows && row.editable != false
			&& (field == null || (field.editable && !field.get_value))
			&& d.can_focus_cell(row, field)
	}

	d.create_editor = function(row, field) {
		return field.editor.call(d, field)
	}

	d.set_value = function(row, field, val, source) {

		if (!d.can_change_value(row, field))
			return 'read only'

		let ret = d.validate_value(field, val)
		if (ret !== true)
			return ret

		if (!row.original_values)
			row.original_values = row.values.slice(0)

		row.values[field.index] = val
		row.modified = true

		d.fire('value_changed', row, field, val, source)

		return true
	}

	// add/remove rows --------------------------------------------------------

	function create_row() {
		let values = []
		// add server_default values or null
		for (let field of fields) {
			let val = field.server_default
			values.push(val != null ? val : null)
		}
		let row = {values: values, is_new: true}
		// set default client values.
		for (let field of fields)
			d.set_value(row, field, field.client_default)
		return row
	}

	d.add_row = function(source) {
		if (!d.can_add_rows)
			return
		let row = create_row()
		rows.push(row)
		d.fire('row_added', row, source)
		return row
	}

	d.can_remove_row = function(row) {
		if (!d.can_remove_rows)
			return false
		if (row.can_remove === false)
			return false
		return true
	}

	d.remove_row = function(row, source) {
		if (!d.can_remove_row(row))
			return
		if (row.is_new) {
			rows.remove(rows.indexOf(row))
		} else {
			// mark row as removed
			row.removed = true
		}
		d.fire('row_removed', row, source)
		return row
	}

	// changeset --------------------------------------------------------------

	d.original_value = function(row, field) {
		let values = row.original_values || row.values
		return values[field.index]
	}

	d.value_changed = function(row, field) {
		let t = row.original_values
		return t && t[field.index] !== row.values[field.index]
	}

	// saving

	d.save_row = function(row) {
		let ret = d.validate_row(row)
		let ok = ret === true
		row.invalid = !ok
		return ok
	}

	init()

	return d
}

// field templates -----------------------------------------------------------

{
	rowset.types = {
		number: {align: 'right'},
		date  : {align: 'right'},
	}

	rowset.types.number.validate = function(val, field) {
		val = parseFloat(val)
		return typeof(val) == 'number' && val === val || 'invalid number'
	}

	rowset.types.number.editor = function() {
		return spin_input({
			button_placement: 'left',
		})
	}

	rowset.types.date.format = function(t, field) {
		_d.setTime(t)
		return _d.toLocaleString(locale, rowset.types.date.format.format)
	}
	rowset.types.date.format.format = {weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }

	rowset.types.date.editor = function() {
		return dropdown({
			picker: calendar(),
			classes: 'align-right fixed',
		})
	}

	rowset.default_type = {
		align: 'left',
		client_default: null,
		server_default: null,
		allow_null: true,
		editable: true,
		sortable: true,
	}

	rowset.default_type.format = function(v) {
		return String(v)
	}

	rowset.default_type.editor = function() {
		return input()
	}

}

// ---------------------------------------------------------------------------
// button
// ---------------------------------------------------------------------------

button = component('x-button', HTMLButtonElement, 'button', function(e) {

	e.class('x-widget')
	e.class('x-button')

	e.icon_span = H.span({class: 'x-button-icon'})
	e.text_span = H.span({class: 'x-button-text'})
	e.add(e.icon_span, e.text_span)

	e.init = function() {

		e.icon_span.add(e.icon)
		e.icon_span.classes = e.icon_classes

		// can't use CSS for this because margins don't collapse with paddings.
		if (!(e.icon_classes || e.icon))
			e.icon_span.hide()

		e.on('click', e.click)
	}

	e.property('text', function() {
		return e.text_span.innerHTML
	}, function(s) {
		e.text_span.innerHTML = s
	})

	e.css_property('primary')

	e.detach = function() {
		e.fire('detach') // for auto-closing attached popup menus.
	}

})

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

input = component('x-input', function(e) {

	e.class('x-widget')
	e.class('x-input')

	e.tooltip = H.div({class: 'x-input-error-ct'}, H.div({class: 'x-input-error'}))
	e.tooltip.style.display = 'none'
	e.input = H.input({class: 'x-input-input'})
	e.input.set_input_filter() // must be set as first event handler!
	e.input.on('input', input_input)
	e.input.on('focus', input_focus)
	e.input.on('blur', input_blur)
	e.add(e.input, e.tooltip)

	function set_valid(err) {
		e.invalid = err != true
		e.input.class('invalid', e.invalid)
		e.error = e.invalid && err || ''
		e.tooltip.at[0].innerHTML = e.error
		e.tooltip.style.display = e.error ? null : 'none'
	}

	let value, value_set

	e.init = function() {
		if ('default_value' in e) {
			value = e.default_value
			value_set = true
		}
	}

	function get_value() {
		return value
	}

	function set_value(v, from_user_input) {
		if (value_set && v === value) // event loop barrier
			return true
		let err = e.validate(v)
		if (err != true) // invalid value spread barrier
			return err
		set_valid(true)
		e.input.value = e.to_text(v)
		value = v
		value_set = true
		e.fire('value_changed', v, from_user_input) // input protocol
		return true
	}

	e.late_property('value', get_value, set_value)

	// view

	function input_input() {
		let v = e.from_text(e.input.value)
		set_valid(set_value(v, true))
	}

	function input_focus() {
		e.tooltip.style.display = e.error ? null : 'none'
	}

	function input_blur() {
		e.tooltip.style.display = 'none'
		e.fire('lost_focus') // grid editor protocol
	}

	e.validate = function(v) {
		return true
	}

	e.to_text = function(v) {
		return v != null ? String(v) : null
	}

	e.from_text = function(s) {
		s = s.trim()
		return s !== '' ? s : null
	}

	// editor protocol

	e.focus = function() {
		e.input.focus()
	}

	e.editor_selection = function(field) {
		return [e.input.selectionStart, e.input.selectionEnd]
	}

	e.enter_editor = function(field, sel0, sel1) {
		if (sel0 == null)
			return
		if (sel1 == null)
			sel1 = sel0
		e.input.select(sel0, sel1)
	}

})

// ---------------------------------------------------------------------------
// spin_input
// ---------------------------------------------------------------------------

spin_input = component('x-spin-input', input, function(e) {

	e.class('x-spin-input')

	// model

	e.step =  1
	e.min  = -1/0
	e.max  =  1/0

	// view

	e.up   = H.div({class: 'x-spin-input-button fa'})
	e.down = H.div({class: 'x-spin-input-button fa'})

	e.attr_property('button-style'    , 'plus-minus')
	e.attr_property('button-placement', 'auto')

	let init = e.init
	e.init = function() {

		init.call(this)

		let bs = e.button_style
		let bp = e.button_placement; bp = bp != 'auto' && bp

		if (bs == 'plus-minus') {
			e.up  .class('fa-plus')
			e.down.class('fa-minus')
			bp = bp || 'each-side'
		} else if (bs == 'up-down') {
			e.up  .class('fa-caret-up')
			e.down.class('fa-caret-down')
			bp = bp || 'left'
		} else if (bs == 'left-right') {
			e.up  .class('fa-caret-right')
			e.down.class('fa-caret-left')
			bp = bp || 'each-side'
		}

		if (bp == 'each-side') {
			e.insert(0, e.down)
			e.add(e.up)
			e.down.class('left' )
			e.up  .class('right')
			e.down.class('leftmost' )
			e.up  .class('rightmost')
		} else if (bp == 'right') {
			e.add(e.down, e.up)
			e.down.class('right')
			e.up  .class('right')
			e.up  .class('rightmost')
		} else if (bp == 'left') {
			e.insert(0, e.down, e.up)
			e.down.class('left')
			e.up  .class('left')
			e.down.class('leftmost' )
		}

	}

	// controller

	e.input.input_filter = function(v) {
		return /^[\-]?\d*\.?\d*$/.test(v) // allow digits and '.' only
	}

	e.min_error  = function() { return 'Value must be at least {0}'.format(e.min) }
	e.max_error  = function() { return 'Value must be at most {0}'.format(e.max) }
	e.step_error = function() {
		if (e.step == null) return true
		if (e.step == 1) return 'Value must be an integer'
		return 'Value must be multiple of {0}'.format(e.step)
	}

	e.validate = function(v) {
		if (v < e.min) return e.min_error(v)
		if (v > e.max) return e.max_error(v)
		if (v % e.step != 0) return e.step_error(v)
		return true
	}

	e.from_text = function(s) {
		return s !== '' ? Number(s) : null
	}

	e.to_text = function(x) {
		return x != null ? String(x) : ''
	}

	let increment
	function increment_value() {
		if (!increment) return
		e.value += increment
		e.input.select(0, -1)
	}
	let increment_timer
	function start_incrementing() {
		increment_value()
		increment_timer = setInterval(increment_value, 100)
	}
	let start_incrementing_timer
	function add_events(button, sign) {
		button.on('mousedown', function() {
			if (start_incrementing_timer || increment_timer)
				return
			e.input.focus()
			increment = e.step * sign
			increment_value()
			start_incrementing_timer = setTimeout(start_incrementing, 500)
		})
		function mouseup() {
			clearTimeout(start_incrementing_timer)
			clearInterval(increment_timer)
			start_incrementing_timer = null
			increment_timer = null
			increment = 0
		}
		button.on('mouseup', mouseup)
		button.on('mouseleave', mouseup)
	}
	add_events(e.up  , 1)
	add_events(e.down, -1)

	e.input.on('wheel', function(dy) {
		e.value += (dy / 100)
		e.input.select(0, -1)
		return false
	})

})

// ---------------------------------------------------------------------------
// dropdown
// ---------------------------------------------------------------------------

dropdown = component('x-dropdown', function(e) {

	// view

	e.class('x-widget')
	e.class('x-input')
	e.class('x-dropdown')

	e.attrval('tabindex', 0)

	e.value_div = H.span({class: 'x-dropdown-value'})
	e.button = H.span({class: 'x-dropdown-button fa fa-caret-down'})
	e.add(e.value_div, e.button)

	function update_view() {
		if (!e.isConnected)
			return
		let v = e.picker.display_value
		if (v === '')
			v = '&nbsp;'
		if (typeof(v) == 'string')
			e.value_div.innerHTML = v
		else
			e.value_div.replace(0, v)
	}

	function onoff_events(on) {
		document.onoff('mousedown', document_mousedown, on)
		document.onoff('stopped_event', document_stopped_event, on)
	}

	e.attach = function(parent) {
		update_view()
		onoff_events(true)
	}

	e.detach = function() {
		onoff_events(false)
		e.close()
	}

	// model

	e.late_property('value', function() {
		return e.picker.value
	}, function(v) {
		e.picker.pick_value(v)
	})

	// controller

	e.on('focusout' , view_focusout)
	e.on('mousedown', view_mousedown)
	e.on('keydown'  , view_keydown)
	e.on('wheel'    , view_wheel)

	e.init = function() {
		e.picker.on('value_changed', value_changed)
		e.picker.on('value_picked' , value_picked)
		e.picker.on('keydown', picker_keydown)
	}

	// focusing

	let builtin_focus = e.focus
	let focusing_picker
	e.focus = function() {
		if (e.isopen) {
			focusing_picker = true // focusout barrier.
			e.picker.focus()
			focusing_picker = false
		} else
			builtin_focus.call(this)
	}

	// opening & closing

	e.set_open = function(open, focus) {
		if (e.isopen != open) {
			e.class('open', open)
			e.button.replace_class('fa-caret-down', 'fa-caret-up', open)
			e.picker.class('picker', open)
			if (open) {
				e.cancel_value = e.value
				let r = e.getBoundingClientRect()
				e.picker.x = r.left   + window.scrollX
				e.picker.y = r.bottom + window.scrollY
				e.picker.min_w = r.width
				document.body.add(e.picker)
				e.fire('opened')
			} else {
				e.cancel_value = null
				e.picker.remove()
				e.fire('closed')
				if (!focus)
					e.fire('lost_focus') // grid editor protocol
			}
		}
		if (focus)
			e.focus()
	}

	e.open   = function(focus) { e.set_open(true, focus) }
	e.close  = function(focus) { e.set_open(false, focus) }
	e.toggle = function(focus) { e.set_open(!e.isopen, focus) }
	e.cancel = function(focus) {
		if (e.isopen)
			e.value = e.cancel_value
		e.close(focus)
	}

	e.late_property('isopen',
		function() {
			return e.hasclass('open')
		},
		function(open) {
			e.set_open(open, true)
		}
	)

	// picker protocol

	function value_changed(v) {
		update_view()
	}

	function value_picked(from_user_input) {
		e.close(from_user_input)
		e.fire('value_changed', e.picker.value) // input protocol
		if (e.rowset) {
			let err = e.rowset.set_value(e.value)
			// TODO: show error
		}
	}

	// kb & mouse binding

	function view_mousedown(ev) {
		e.toggle(true)
		return false
	}

	function view_keydown(key) {
		if (key == 'Enter' || key == ' ') {
			e.toggle(true)
			return false
		}
		if (key == 'ArrowDown' || key == 'ArrowUp') {
			if (!e.hasclass('grid-editor')) {
				e.picker.pick_near_value(key == 'ArrowDown' ? 1 : -1)
				return false
			}
		}
	}

	function picker_keydown(key, shift, ctrl, alt, ev) {
		if (key == 'Escape' || key == 'Tab') {
			e.cancel(true)
			return false
		}
	}

	function view_wheel(dy) {
		e.picker.pick_near_value(dy / 100)
		return false
	}

	// clicking outside the picker closes the picker.
	function document_mousedown(ev) {
		if (e.contains(ev.target)) // clicked inside the dropdown.
			return
		if (e.picker.contains(ev.target)) // clicked inside the picker.
			return
		e.cancel()
	}

	// clicking outside the picker closes the picker, even if the click did something.
	function document_stopped_event(ev) {
		if (ev.type == 'mousedown')
			document_mousedown(ev)
	}

	function view_focusout(ev) {
		// prevent dropdown's focusout from bubbling to the parent when opening the picker.
		if (focusing_picker)
			return false
		e.fire('lost_focus') // grid editor protocol
	}

	// editor protocol (stubs)

	e.editor_selection = function(field) { return [0, 0] }
	e.enter_editor = function(field, sel1, sel2) {}

})

// ---------------------------------------------------------------------------
// listbox
// ---------------------------------------------------------------------------

listbox = component('x-listbox', function(e) {

	e.class('x-widget')
	e.class('x-listbox')
	e.class('x-focusable')
	e.attrval('tabindex', 0)

	e.page_size = 10

	e.init = function() {

		for (item of e.items) {
			let text = typeof(item) == 'string' ? item : item.text
			let item_div = H.div({class: 'x-listbox-item x-item'}, text)
			e.add(item_div)
			item_div.item = item
			item_div.on('mousedown', item_mousedown)
		}

	}

	// model

	e.late_property('selected_index', function() {
		return e.selected_item ? e.selected_item.index : null
	}, function(i) {
		select_item_by_index(i)
	})

	alias(e, 'value', 'selected_index')

	// controller

	e.attach = function() {
		if (e.selected_item)
			e.selected_item.make_visible()
	}

	e.on('keydown', list_keydown)

	function select_item_by_index(i, pick, from_user_input) {
		let item = null
		if (i != null) {
			i = clamp(i, 0, e.at.length-1)
			item = e.at[i]
		}
		return select_item(item, pick, from_user_input)
	}

	function select_item(item, pick, from_user_input) {
		if (item != e.selected_item) {
			if (e.selected_item) {
				e.selected_item.class('focused', false)
				e.selected_item.class('selected', false)
			}
			if (item) {
				item.class('focused')
				item.class('selected')
				item.make_visible()
			}
			e.selected_item = item
			e.fire('selected', item ? item.item : null)
			e.fire('value_changed', item ? item.index : null, from_user_input)
		}
		if (pick)
			e.fire('value_picked', from_user_input) // dropdown protocol
	}

	function item_mousedown() {
		e.focus()
		select_item(this, true, true)
		return false
	}

	function list_keydown(key) {
		let d
		switch (key) {
			case 'ArrowUp'   : d = -1; break
			case 'ArrowDown' : d =  1; break
			case 'ArrowLeft' : d = -1; break
			case 'ArrowRight': d =  1; break
			case 'PageUp'    : d = -e.page_size; break
			case 'PageDown'  : d =  e.page_size; break
			case 'Home'      : d = -1/0; break
			case 'End'       : d =  1/0; break
		}
		if (d) {
			select_item_by_index(e.selected_index + d, false, true)
			return false
		}
		if (key == 'Enter') {
			if (e.selected_item)
				e.fire('value_picked', true) // dropdown protocol
			return false
		}
	}

	// dropdown protocol

	e.property('display_value', function() {
		return e.selected_item ? e.selected_item.innerHTML : ''
	})

	e.pick_value = function(v) {
		select_item_by_index(v, true, false)
	}

	e.pick_near_value = function(delta) {
		select_item_by_index(e.selected_index + delta, true, false)
	}

})

// ---------------------------------------------------------------------------
// calendar
// ---------------------------------------------------------------------------

function month_names() {
	let a = []
	for (let i = 0; i <= 11; i++)
		a.push(month_name(utctime(0, i), 'short'))
	return a
}

calendar = component('x-calendar', function(e) {

	e.class('x-widget')
	e.class('x-calendar')
	e.class('x-focusable')
	e.attrval('tabindex', 0)

	e.format = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }

	e.sel_day = H.div({class: 'x-calendar-sel-day'})
	e.sel_day_suffix = H.div({class: 'x-calendar-sel-day-suffix'})
	e.sel_month = dropdown({
		classes: 'x-calendar-sel-month x-dropdown-nowrap',
		picker: listbox({
			items: month_names(),
		}),
	})
	e.sel_year = spin_input({
		classes: 'x-calendar-sel-year',
		min: 1000,
		max: 3000,
		button_style: 'left-right',
	})
	e.sel_month.on('value_changed', month_changed)
	e.sel_year.on('value_changed', year_changed)
	e.header = H.div({class: 'x-calendar-header'},
		e.sel_day, e.sel_day_suffix, e.sel_month, e.sel_year)
	e.weekview = H.table({class: 'x-calendar-weekview'})
	e.on('keydown', view_keydown)
	e.sel_month.on('keydown', sel_month_keydown)
	e.sel_year.on('keydown', sel_year_keydown)
	e.weekview.on('wheel', weekview_wheel)
	e.add(e.header, e.weekview)

	// model

	let value = day(0)
	e.late_property('value',
		function() {
			return value
		},
		function(t) {
			t = day(t)
			if (t != t) // NaN
				return
			if (t === value)
				return
			value = t
			this.fire('value_changed', t) // dropdown protocol
			update_view()
		}
	)

	// view

	function update_view() {
		let t = e.value
		update_weekview(t, 6)
		let y = year_of(t)
		let n = floor(1 + days(t - month(t)))
		e.sel_day.innerHTML = n
		let day_suffixes = ['', 'st', 'nd', 'rd']
		e.sel_day_suffix.innerHTML = locale.starts('en') ?
			(n < 11 || n > 13) && day_suffixes[n % 10] || 'th' : ''
		e.sel_month.value = month_of(t)
		e.sel_year.value = y
	}

	function update_weekview(d, weeks) {
		let today = day(now())
		let this_month = month(d)
		d = week(this_month)
		e.weekview.clear()
		for (let week = 0; week <= weeks; week++) {
			let tr = H.tr()
			for (let weekday = 0; weekday < 7; weekday++) {
				if (!week) {
					let th = H.th({class: 'x-calendar-weekday'}, weekday_name(day(d, weekday)))
					tr.add(th)
				} else {
					let m = month(d)
					let s = d == today ? ' today' : ''
					s = s + (m == this_month ? ' current-month' : '')
					s = s + (d == e.value ? ' focused selected' : '')
					let td = H.td({class: 'x-calendar-day x-item'+s}, floor(1 + days(d - m)))
					td.date = d
					td.on('mousedown', day_mousedown)
					tr.add(td)
					d = day(d, 1)
				}
			}
			e.weekview.add(tr)
		}
	}

	// controller

	e.attach = function() {
		update_view()
	}

	function day_mousedown() {
		e.value = this.date
		e.sel_month.cancel()
		e.focus()
		e.fire('value_picked', true) // dropdown protocol
		return false
	}

	function month_changed() {
		_d.setTime(e.value)
		_d.setMonth(this.value)
		e.value = _d.valueOf()
	}

	function year_changed() {
		_d.setTime(e.value)
		_d.setFullYear(this.value)
		e.value = _d.valueOf()
	}

	function weekview_wheel(dy) {
		e.value = day(e.value, 7 * dy / 100)
		return false
	}

	function view_keydown(key, shift) {
		if (!e.focused) // other inside element got focus
			return
		if (key == 'Tab' && e.hasclass('picker')) { // capture Tab navigation.
			if (shift)
				e.sel_year.focus()
			else
				e.sel_month.focus()
			return false
		}
		let d, m
		switch (key) {
			case 'ArrowLeft'  : d = -1; break
			case 'ArrowRight' : d =  1; break
			case 'ArrowUp'    : d = -7; break
			case 'ArrowDown'  : d =  7; break
			case 'PageUp'     : m = -1; break
			case 'PageDown'   : m =  1; break
		}
		if (d) {
			e.value = day(e.value, d)
			return false
		}
		if (m) {
			_d.setTime(e.value)
			if (shift)
				_d.setFullYear(year_of(e.value) + m)
			else
				_d.setMonth(month_of(e.value) + m)
			e.value = _d.valueOf()
			return false
		}
		if (key == 'Home') {
			e.value = shift ? year(e.value) : month(e.value)
			return false
		}
		if (key == 'End') {
			e.value = day(shift ? year(e.value, 1) : month(e.value, 1), -1)
			return false
		}
		if (key == 'Enter') {
			e.fire('value_picked', true) // dropdown protocol
			return false
		}
	}

	function sel_month_keydown(key, shift) {
		if (key == 'Tab' && e.hasclass('picker')) {// capture Tab navigation.
			if (shift)
				e.focus()
			else
				e.sel_year.focus()
			return false
		}
	}

	function sel_year_keydown(key, shift) {
		if (key == 'Tab' && e.hasclass('picker')) { // capture Tab navigation.
			if (shift)
				e.sel_month.focus()
			else
				e.focus()
			return false
		}
	}

	// dropdown protocol

	e.property('display_value', function() {
		_d.setTime(e.value)
		return _d.toLocaleString(locale, e.format)
	})

	e.pick_value = function(v) {
		e.value = v
		e.fire('value_picked', false)
	}

	e.pick_near_value = function(delta) {
		e.value = day(e.value, delta)
		e.fire('value_picked', false)
	}

})

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------

menu = component('x-menu', function(e) {

	function create_item(a) {
		let check_div = H.div({class: 'x-menu-check-div fa fa-check'})
		let icon_div  = H.div({class: 'x-menu-icon-div '+(a.icon_class || '')})
		let check_td  = H.td ({class: 'x-menu-check-td'}, check_div, icon_div)
		let title_td  = H.td ({class: 'x-menu-title-td'}, a.text)
		let key_td    = H.td ({class: 'x-menu-key-td'}, a.key)
		let sub_div   = H.div({class: 'x-menu-sub-div fa fa-caret-right'})
		let sub_td    = H.td ({class: 'x-menu-sub-td'}, sub_div)
		sub_div.style.visibility = a.actions ? null : 'hidden'
		let tr = H.tr({class: 'x-menu-tr'}, check_td, title_td, key_td, sub_td)
		tr.class('enabled', a.enabled != false)
		tr.action = a
		tr.check_div = check_div
		update_check(tr)
		tr.on('mousedown' , item_mousedown)
		tr.on('mouseenter', item_mouseenter)
		tr.on('mouseleave', item_mouseleave)
		return tr
	}

	function create_separator() {
		let td = H.td({colspan: 5}, H.hr())
		let tr = H.tr({class: 'x-menu-separator-tr'}, td)
		return tr
	}

	function create_menu(actions) {
		let table = H.table({class: 'x-menu-table'})
		for (let i = 0; i < actions.length; i++) {
			let a = actions[i]
			table.add(create_item(a))
			if (a.separator)
				table.add(create_separator())
		}
		table.on('mouseenter', menu_mouseenter)
		table.on('mouseleave', menu_mouseleave)
		return table
	}

	function show_menu(x, y, pe) {
		pe = pe || document.body
		let table = create_menu(e.actions)
		table.x = pe.offsetLeft + x
		table.y = pe.offsetTop + pe.offsetHeight + y
		document.body.add(table)
		table.document_mousedown = function() {
			e.close()
		}
		document.on('mousedown', table.document_mousedown)
		pe.on('detach', e.close)
		return table
	}

	function hide_menu(table) {
		table.remove()
		document.off('mousedown', table.document_mousedown)
	}

	function show_submenu(item_tr) {
		let actions = item_tr.action.actions
		if (!actions)
			return
		let table = create_menu(actions)
		table.x = item_tr.clientWidth - 2
		item_tr.submenu_table = table
		item_tr.add(table)
		return table
	}

	function hide_submenu(item_tr) {
		if (!item_tr)
			return
		if (!item_tr.submenu_table)
			return
		if (item_tr.submenu_table.keep_open)
			return
		item_tr.submenu_table.remove()
		item_tr.submenu_table = null
	}

	function update_check(tr) {
		tr.check_div.style.display = tr.action.checked != null ? null : 'none'
		tr.check_div.style.visibility = tr.action.checked ? null : 'hidden'
	}

	function item_mousedown() {
		let a = this.action
		if ((a.click || a.checked != null) && this.hasclass('enabled')) {
			if (a.checked != null) {
				a.checked = !a.checked
				update_check(this)
			}
			if (!a.click || a.click(a) != false)
				e.close()
		}
		return false
	}

	function menu_mouseenter() {
		this.keep_open = true
	}

	function menu_mouseleave() {
		this.keep_open = false
	}

	function item_mouseenter() {
		let tr = this
		hide_submenu(tr.parent.selected_item_tr)
		show_submenu(tr)
		tr.parent.selected_item_tr = tr
	}

	function item_mouseleave() {
		let tr = this
		hide_submenu(tr)
		tr.parent.selected_item_tr = null
	}

	e.popup = function(x, y, offset_parent) {
		if (e.table)
			return
		e.table = show_menu(x, y, offset_parent)
	}

	e.close = function() {
		if (!e.table)
			return
		hide_menu(e.table)
		e.table = null
	}

})

// ---------------------------------------------------------------------------
// pagelist
// ---------------------------------------------------------------------------

pagelist = component('x-pagelist', function(e) {

	e.class('x-widget')
	e.class('x-pagelist')

	e.init = function() {
		if (e.items)
			for (let i = 0; i < e.items.length; i++) {
				let item = e.items[i]
				if (typeof(item) == 'string')
					item = {text: item}
				let item_div = H.div({class: 'x-pagelist-item', tabindex: 0}, item.text)
				item_div.on('mousedown', item_mousedown)
				item_div.on('keydown'  , item_keydown)
				item_div.item = item
				item_div.index = i
				e.add(item_div)
			}
		e.selection_bar = H.div({class: 'x-pagelist-selection-bar'})
		e.add(e.selection_bar)
	}

	// controller

	e.attach = function() {
		e.selected_index = e.selected_index
	}

	function select_item(idiv) {
		if (e.selected_item) {
			e.selected_item.class('selected', false)
			e.fire('close', e.selected_item.index)
			if (e.page_container)
				e.page_container.clear()
		}
		e.selection_bar.style.display = idiv ? null : 'none'
		e.selected_item = idiv
		if (idiv) {
			idiv.class('selected', true)
			e.selection_bar.x = idiv.offsetLeft
			e.selection_bar.w = idiv.clientWidth
			e.fire('open', idiv.index)
			if (e.page_container) {
				let page = idiv.item.page
				if (page)
					e.page_container.add(page)
			}
		}
	}

	function item_mousedown() {
		select_item(this)
		this.focus()
		return false
	}

	function item_keydown(key) {
		if (key == ' ' || key == 'Enter') {
			select_item(this)
			return false
		}
		if (key == 'ArrowRight' || key == 'ArrowLeft') {
			e.selected_index += (key == 'ArrowRight' ? 1 : -1)
			if (e.selected_item)
				e.selected_item.focus()
			return false
		}
	}

	// selected_index property.

	e.late_property('selected_index',
		function() {
			return e.selected_item ? e.selected_item.index : null
		},
		function(i) {
			let idiv = e.at[clamp(i, 0, e.children.length-2)]
			if (!idiv)
				return
			select_item(idiv)
		}
	)

})

// ---------------------------------------------------------------------------
// grid
// ---------------------------------------------------------------------------

// sign() that only returns only -1 or 1, never 0, and returns -1 for -0.
function strict_sign(x) {
	return 1/x == 1/-0 ? -1 : (x >= 0 ? 1 : -1)
}

grid = component('x-grid', function(e) {

	// geometry
	e.w = 400
	e.h = 400
	e.row_h = 26
	e.row_border_h = 1
	e.min_col_w = 20

	// editing features
	e.can_focus_cells = true
	e.can_edit = true
	e.can_add_rows = true
	e.can_remove_rows = true
	e.can_change_rows = true

	// keyboard behavior
	e.tab_navigation = false    // disabled as it prevents jumping out of the grid.
	e.auto_advance = 'next_row' // advance on enter = false|'next_row'|'next_cell'
	e.auto_advance_row = true   // jump row on horiz. navigation limits
	e.auto_jump_cells = true    // jump to next/prev cell on caret limits
	e.keep_editing = true       // re-enter edit mode after navigating
	e.save_cell_on = 'input'    // save cell on 'input'|'exit_edit'
	e.save_row_on = 'exit_edit' // save row on 'input'|'exit_edit'|'exit_row'|false
	e.prevent_exit_edit = false // prevent exiting edit mode on validation errors
	e.prevent_exit_row = true   // prevent changing row on validation errors

	e.class('x-widget')
	e.class('x-grid')
	e.class('x-focusable')
	e.attrval('tabindex', 0)

	create_view()

	e.init = function() {
		create_fields()
		create_rows()
		update_header_table()
	}

	// model ------------------------------------------------------------------

	// when: cols changed, rowset fields changed.
	function create_fields() {
		e.fields = []
		if (e.cols) {
			for (let fi of e.cols)
				if (e.rowset.fields[fi].visible != false)
					e.fields.push(e.rowset.fields[fi])
		} else {
			for (let field of e.rowset.fields)
				if (field.visible != false)
					e.fields.push(field)
		}
		if (e.dropdown_value_col)
			e.dropdown_value_field = e.rowset.field(e.dropdown_value_col)
		if (e.dropdown_display_col)
			e.dropdown_display_field = e.rowset.field(e.dropdown_display_col)
		else
			e.dropdown_display_field = e.dropdown_value_field
	}

	function field_w(field) {
		return max(e.min_col_w, field.w || 0)
	}

	function create_row(row) {
		return {row: row}
	}

	// NOTE: we load only the first 500K rows because of scrollbox
	// implementation limitations of browser rendering engines:
	// Chrome shows drawing artefacts over ~1.3mil rows at standard row height.
	// Firefox resets the scrollbar over ~700K rows at standard row height.
	// A custom scrollbar implementation is needed for rendering larger rowsets.

	// when: entire rowset changed.
	function create_rows() {
		e.rows = []
		let rows = e.rowset.rows
		for (let i = 0; i < min(5e5, rows.length); i++) {
			let row = rows[i]
			if (!row.removed)
				e.rows.push(create_row(row))
		}
	}

	function row_index(row) {
		for (let i = 0; i < e.rows.length; i++)
			if (e.rows[i].row == row)
				return i
	}

	function row_field_at(cell) {
		let [ri, fi] = cell
		return [ri != null ? e.rows[ri] : null, fi != null ? e.fields[fi] : null]
	}

	function can_change_value(row, field) {
		return e.can_edit && e.can_change_rows
			&& e.rowset.can_change_value(row.row, field)
	}

	function can_focus_cell(row, field, for_editing) {
		return (field == null || e.can_focus_cells)
			&& e.rowset.can_focus_cell(row.row, field)
			&& (!for_editing || can_change_value(row, field))
	}

	function find_row(field, v) {
		for (let ri = 0; ri < e.rows.length; ri++)
			if (e.rows[ri].row.values[field.index] == v)
				return ri
	}

	// rendering / geometry ---------------------------------------------------

	function scroll_y(sy) {
		return clamp(sy, 0, max(0, e.rows_h - e.rows_view_h))
	}

	function scroll_to_cell(cell) {
		let [ri, fi] = cell
		if (ri == null)
			return
		let view = e.rows_view_div
		let th = fi != null && e.header_tr.at[fi]
		let h = e.row_h
		let y = h * ri
		let x = th ? th.offsetLeft  : 0
		let w = th ? th.clientWidth : 0
		view.scroll_to_view_rect(x, y, w, h)
	}

	function first_visible_row(sy) {
		return floor(sy / e.row_h)
	}

	function rows_y_offset(sy) {
		return floor(sy - sy % e.row_h)
	}

	// when: row count or height changed, rows viewport height changed, header height changed.
	function update_heights() {
		e.rows_h = e.row_h * e.rows.length - floor(e.row_border_h / 2)
		e.rows_view_h = e.clientHeight - e.header_table.clientHeight
		e.rows_div.h = e.rows_h
		e.rows_view_div.h = e.rows_view_h
		e.visible_row_count = floor(e.rows_view_h / e.row_h) + 2
		e.page_rows = floor(e.rows_view_h / e.row_h)
		update_input_geometry()
	}

	function tr_at(ri) {
		let sy = e.scroll_y
		let i0 = first_visible_row(sy)
		let i1 = i0 + e.visible_row_count
		return e.rows_table.at[ri - i0]
	}

	function tr_td_at(cell) {
		let [ri, fi] = cell
		let tr = ri != null && tr_at(ri)
		return [tr, tr && fi != null ? tr.at[fi] : null]
	}

	// rendering --------------------------------------------------------------

	function create_view() {

		e.header_tr = H.tr()
		e.header_table = H.table({class: 'x-grid-header-table'}, e.header_tr)
		e.rows_table = H.table({class: 'x-grid-rows-table'})
		e.rows_div = H.div({class: 'x-grid-rows-div'}, e.rows_table)
		e.rows_view_div = H.div({class: 'x-grid-rows-view-div'}, e.rows_div)
		e.add(e.header_table, e.rows_view_div)

		e.on('mousemove', view_mousemove)
		e.on('keydown'  , view_keydown)
		e.on('keypress' , view_keypress)

		e.rows_view_div.on('scroll', update_view)
	}

	// when: fields changed.
	function update_header_table() {
		set_header_visibility()
		e.header_table.clear()
		for (let field of e.fields) {

			let sort_icon     = H.span({class: 'fa x-grid-sort-icon'})
			let sort_icon_pri = H.span({class: 'x-grid-header-sort-icon-pri'})
			let e1 = H.td({class: 'x-grid-header-title-td'}, field.name)
			let e2 = H.td({class: 'x-grid-header-sort-icon-td'}, sort_icon, sort_icon_pri)
			if (field.align == 'right')
				[e1, e2] = [e2, e1]
			e1.attr('align', 'left')
			e2.attr('align', 'right')
			let title_table =
				H.table({class: 'x-grid-header-th-table'},
					H.tr(0, e1, e2))

			let th = H.th({class: 'x-grid-header-th x-grid-cell'}, title_table)

			th.field = field
			th.sort_icon = sort_icon
			th.sort_icon_pri = sort_icon_pri

			if (field.w) th.w = field_w(field)
			if (field.max_w) th.max_w = field.max_w
			if (field.min_w) th.min_w = max(10, field.min_w)

			th.on('mousedown', header_cell_mousedown)
			th.on('rightmousedown', header_cell_rightmousedown)
			th.on('contextmenu', function() { return false })

			e.header_tr.add(th)
		}
		e.header_table.add(e.header_tr)
	}

	// when: fields changed, rows viewport height changed.
	function update_rows_table() {
		e.rows_table.clear()
		for (let i = 0; i < e.visible_row_count; i++) {
			let tr = H.tr({class: 'x-grid-tr'})
			for (let i = 0; i < e.fields.length; i++) {
				let th = e.header_tr.at[i]
				let field = e.fields[i]
				let td = H.td({class: 'x-grid-td x-grid-cell'})
				td.w = field_w(field)
				td.h = e.row_h
				td.style['border-bottom-width'] = e.row_border_h + 'px'
				if (field.align)
					td.attr('align', field.align)
				td.on('mousedown', cell_mousedown)
				tr.add(td)
			}
			e.rows_table.add(tr)
		}
	}

	// when: widget height changed.
	function resize_view() {
		update_heights()
		update_rows_table()
		update_view()
	}

	// when: scroll_y changed.
	function update_row(tr, ri) {
		let row = e.rows[ri]
		tr.row = row
		tr.row_index = ri
		if (row)
			tr.class('x-item', can_focus_cell(row))
		for (let fi = 0; fi < e.fields.length; fi++) {
			let field = e.fields[fi]
			let td = tr.at[fi]
			td.field = field
			td.field_index = fi
			if (row) {
				td.innerHTML = e.rowset.display_value(row.row, field)
				td.class('x-item', can_focus_cell(row, field))
				td.class('read-only',
					e.can_focus_cells
					&& e.can_edit
					&& e.rowset.can_edit
					&& e.rowset.can_change_rows
					&& !can_focus_cell(row, field, true))
				td.style.display = null
			} else {
				td.clear()
				td.style.display = 'none'
			}
		}
	}
	function update_rows() {
		let sy = e.scroll_y
		let i0 = first_visible_row(sy)
		e.rows_table.y = rows_y_offset(sy)
		let n = e.visible_row_count
		for (let i = 0; i < n; i++) {
			let tr = e.rows_table.at[i]
			update_row(tr, i0 + i)
		}
	}

	// when: order_by changed.
	function update_sort_icons() {
		for (let th of e.header_tr.children) {
			let dir = e.order_by_dir(th.field)
			let pri = e.order_by_priority(th.field)
			th.sort_icon.class('fa-sort'             , false)
			th.sort_icon.class('fa-angle-up'         , false)
			th.sort_icon.class('fa-angle-double-up'  , false)
			th.sort_icon.class('fa-angle-down'       , false)
			th.sort_icon.class('fa-angle-double-down', false)
			th.sort_icon.class('fa-angle'+(pri ? '-double' : '')+'-up'  , dir == 'asc')
			th.sort_icon.class('fa-angle'+(pri ? '-double' : '')+'-down', dir == 'desc')
			th.sort_icon_pri.innerHTML = pri > 1 ? pri : ''
		}
	}

	function update_focus(set) {
		let [tr, td] = tr_td_at(e.focused_cell)
		if (tr) { tr.class('focused', set); tr.class('editing', e.input && set || false); }
		if (td) { td.class('focused', set); td.class('editing', e.input && set || false); }
	}

	// when: input created, heights changed, column width changed.
	function update_input_geometry() {
		if (!e.input)
			return
		let [ri, fi] = e.focused_cell
		let th = e.header_tr.at[fi]
		let fix = floor(e.row_border_h / 2 + (window.chrome ? .5 : 0))
		e.input.x = th.offsetLeft
		e.input.y = e.row_h * ri + fix
		e.input.w = th.clientWidth
		e.input.h = e.row_h - e.row_border_h
		e.input.style['padding-bottom'] = fix + 'px'
	}

	// when: col resizing.
	function update_col_width(td_index, w) {
		for (let tr of e.rows_table.children) {
			let td = tr.at[td_index]
			td.w = w
		}
	}

	// when: horizontal scrolling, widget width changed.
	function update_header_x(sx) {
		e.header_table.x = -sx
	}

	function set_header_visibility() {
		if (e.header_visible != false && !e.hasclass('picker'))
			e.header_table.show()
		else
			e.header_table.hide()
	}

	function update_view() {
		let sy = e.rows_view_div.scrollTop
		let sx = e.rows_view_div.scrollLeft
		update_focus(false)
		sy = scroll_y(sy)
		e.scroll_y = sy
		update_rows()
		update_focus(true)
		update_header_x(sx)
	}

	function create_editor(sel0, sel1) {
		let [row, field] = row_field_at(e.focused_cell)
		let [_, td] = tr_td_at(e.focused_cell)
		update_focus(false)

		e.input = d.create_editor(row, field)
		e.input.value = e.rowset.value(row.row, field)

		e.input.class('grid-editor')

		e.input.enter_editor(field, sel0, sel1)

		e.input.on('value_changed', input_value_changed)
		e.input.on('lost_focus', editor_lost_focus)

		e.rows_div.add(e.input)
		update_input_geometry()
		if (td)
			td.innerHTML = null
		update_focus(true)
	}

	function free_editor() {
		let input = e.input
		let [row, field] = row_field_at(e.focused_cell)
		let [tr, td] = tr_td_at(e.focused_cell)
		update_focus(false)
		e.input = null // clear it before removing it for input_focusout!
		e.rows_div.removeChild(input)
		if (td)
			td.innerHTML = e.rowset.display_value(row.row, field)
		update_focus(true)
	}

	function reload() {
		e.focused_cell = [null, null]
		create_rows()
		update_heights()
		update_view()
		e.focus_cell()
	}

	function hook_unhook_events(on) {
		document.onoff('mousedown', document_mousedown, on)
		document.onoff('mouseup'  , document_mouseup  , on)
		document.onoff('mousemove', document_mousemove, on)
		e.rowset.onoff('reload'       , reload       , on)
		e.rowset.onoff('value_changed', value_changed, on)
		e.rowset.onoff('row_added'    , row_added    , on)
		e.rowset.onoff('row_removed'  , row_removed  , on)
	}

	function copy_keys(dst, src, keys) {
		for (k in keys)
			dst[k] = src[k]
	}

	let picker_forced_options = {can_edit: 1, can_focus_cells: 1}

	function set_picker_options() {
		e._saved = {}
		copy_keys(e._saved, e, picker_forced_options)
		let as_picker = e.hasclass('picker')
		e.can_edit        = !as_picker
		e.can_focus_cells = !as_picker
	}

	function unset_picker_options() {
		copy_keys(e, e._saved, picker_forced_options)
		e._saved = null
	}

	e.attach = function(parent) {
		set_header_visibility()
		set_picker_options()
		update_heights()
		update_rows_table()
		update_view()
		hook_unhook_events(true)
		e.focus_cell()
	}

	e.detach = function() {
		hook_unhook_events(false)
		unset_picker_options()
	}

	// make columns resizeable ------------------------------------------------

	let hit_th, hit_x

	function document_mousedown() {
		if (window.grid_col_resizing || !hit_th)
			return
		e.focus()
		window.grid_col_resizing = true
		e.class('col-resizing')
	}

	function document_mouseup() {
		window.grid_col_resizing = false
		e.class('col-resizing', false)
	}

	function view_mousemove(mx, my) {
		if (window.grid_col_resizing)
			return
		// hit-test for column resizing.
		hit_th = null
		if (mx <= e.rows_view_div.offsetLeft + e.rows_view_div.clientWidth) {
			// ^^ not over vertical scrollbar.
			for (let th of e.header_tr.children) {
				hit_x = mx - (e.header_table.offsetLeft + th.offsetLeft + th.offsetWidth)
				if (hit_x >= -5 && hit_x <= 5) {
					hit_th = th
					break
				}
			}
		}
		e.class('col-resize', hit_th != null)
	}

	function document_mousemove(mx, my) {
		if (!e.hasclass('col-resizing'))
			return
		let field = e.fields[hit_th.index]
		let w = mx - (e.header_table.offsetLeft + hit_th.offsetLeft + hit_x)
		let min_w = max(e.min_col_w, field.min_w || 0)
		let max_w = max(min_w, field.max_w || 1000)
		hit_th.w = clamp(w, min_w, max_w)
		update_col_width(hit_th.index, hit_th.clientWidth)
		update_input_geometry()
		return false
	}

	// focusing ---------------------------------------------------------------

	e.focused_cell = [null, null]

	e.first_focusable_cell = function(cell, rows, cols, options) {

		if (cell == null) cell = e.focused_cell // null cell means focused cell.
		if (rows == null) rows = 0 // by default find the first focusable row.
		if (cols == null) cols = 0 // by default find the first focusable col.

		let for_editing = options && options.for_editing // skip non-editable cells.
		let must_move = options && options.must_move // return only if moved.
		let must_not_move_row = options && options.must_not_move_row // return only if row not moved.
		let must_not_move_col = options && options.must_not_move_col // return only if col not moved.

		let [ri, fi] = cell
		let ri_inc = strict_sign(rows)
		let fi_inc = strict_sign(cols)
		rows = abs(rows)
		cols = abs(cols)
		let move_row = rows >= 1
		let move_col = cols >= 1
		let start_ri = ri
		let start_fi = fi

		// the default cell is the first or the last depending on direction.
		if (ri == null) ri = ri_inc * -1/0
		if (fi == null) fi = fi_inc * -1/0

		// clamp out-of-bound row/col indices.
		ri = clamp(ri, 0, e.rows.length-1)
		fi = clamp(fi, 0, e.fields.length-1)

		let last_valid_ri = null
		let last_valid_fi = null
		let last_valid_row

		// find the last valid row, stopping after the specified row count.
		while (ri >= 0 && ri < e.rows.length) {
			let row = e.rows[ri]
			if (can_focus_cell(row, null, for_editing)) {
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
			if (can_focus_cell(last_valid_row, field, for_editing)) {
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

	e.focus_cell = function(cell, rows, cols, options) {

		if (cell == false) { // false means remove focus only.
			cell = [null, null]
		} else {
			cell = e.first_focusable_cell(cell, rows, cols, options)
			if (cell[0] == null) // failure to find cell means cancel.
				return false
		}

		if (e.focused_cell[0] != cell[0]) {
			if (!e.exit_row())
				return false
		} else if (e.focused_cell[1] != cell[1]) {
			if (!e.exit_edit())
				return false
		} else
			return true // same cell.

		update_focus(false)
		e.focused_cell = cell
		update_focus(true)
		if (!options || options.make_visible != false)
			scroll_to_cell(cell)

		if (e.dropdown_value_field) {
			let [row] = row_field_at(cell)
			let v
			if (row)
				v = e.rowset.value(row.row, e.dropdown_value_field)
			e.fire('value_changed', v, true)
		}

		if (cell)
			e.focus()

		return true
	}

	e.focus_next_cell = function(cols, auto_advance_row, for_editing) {
		let dir = strict_sign(cols)
		return e.focus_cell(null, dir * 0, cols, {must_move: true, for_editing: for_editing})
			|| ((auto_advance_row || e.auto_advance_row)
				&& e.focus_cell(null, dir, dir * -1/0, {for_editing: for_editing}))
	}

	function on_last_row() {
		let [ri] = e.first_focusable_cell(null, 1, 0, {must_move: true})
		return ri == null
	}

	function focused_row() {
		let [ri] = e.focused_cell
		return ri != null ? e.rows[ri] : null
	}

	function editor_lost_focus(ev) {
		if (!e.input) // input is being removed.
			return
		if (ev.target != e.input) // other input that bubbled up.
			return
		e.exit_edit()
	}

	// editing ----------------------------------------------------------------

	e.input = null

	/*

	function set_invalid_row(tr, invalid) {
		tr.class('invalid', invalid)
	}

	function set_modified_cell(td, modified) {
		set_invalid_cell(td, false)
		td.class('modified', modified)
		if (modified)
			set_modified_row(td.parent, true)
		else if (no_cell_has_class(td.parent, 'modified'))
			set_modified_row(td.parent, false)
	}

	function set_modified_row(tr, modified) {
		set_invalid_row(tr, false)
		tr.class('modified', modified)
	}
	*/

	function input_value_changed(v) {
		return
		let td = e.focused_td
		let tr = e.focused_tr
		td.class('unsaved', true)
		td.class('modified', true)
		tr.class('modified', true)
		td.class('invalid', false)
		tr.class('invalid', false)
		tr.class('invalid_values', false)
		e.tooltip(td, false)
		e.tooltip(tr, false)
		if (e.save_cell_on == 'input')
			if (!e.save_cell(e.focused_td))
				return
		if (e.save_row_on == 'input')
			if (!e.save_row(e.focused_tr))
				return
	}

	function td_input(td) {
		return td.first
	}

	e.enter_edit = function(sel0, sel1) {
		if (e.input)
			return
		let [row, field] = row_field_at(e.focused_cell)
		if (!can_focus_cell(row, field, true))
			return
		create_editor(sel0, sel1)
		e.input.focus()
	}

	e.exit_edit = function() {
		if (!e.input)
			return true
		/*
		let [tr, td] = tr_td_at(e.focused_cell)
		if (e.save_cell_on == 'exit_edit')
			e.save_cell(td)
		if (e.save_row_on == 'exit_edit')
			e.save_row(tr)
		if (e.prevent_exit_edit)
			if (e.focused_td.hasclass('invalid'))
				return false
		*/
		free_editor()
		return true
	}

	e.exit_row = function() {
		/*
		let tr = e.focused_tr
		if (!tr)
			return true
		let td = e.focused_td
		if (e.save_row_on == 'exit_row')
			e.save_row(tr)
		if (e.prevent_exit_row)
			if (tr.hasclass('invalid_values') || tr.hasclass('invalid'))
				return false
		*/
		if (!e.exit_edit())
			return false
		return true
	}

	// saving -----------------------------------------------------------------

	function cell_data(cell) {
		let [ri, fi] = cell
		let row = e.rows[ri]
		let t = row.metadata[fi]
		if (!t) {
			t = {}
			row.metadata[fi] = t
		}
		return t
	}

	function no_child_has_class(e, classname) {
		for (let c of e.children)
			if (c.hasclass(classname))
				return false
		return true
	}

	e.tooltip = function(e, msg) {
		// let div = H.div({class: 'x-grid-error'}, msg)
		e.title = msg || ''
	}

	e.save_cell = function(cell) {
		let t = cell_data(cell)
		if (!t.unsaved)
			return !t.invalid
		let [row, field] = row_field_at(cell)
		let ret = e.rowset.set_value(row, field, e.input.value, g)
		let ok = ret === true
		t.unsaved = false
		t.invalid = !ok
		td.class('unsaved', t.unsaved)
		td.class('invalid', t.invalid)
		tr.class('invalid_values', !no_child_has_class(tr, 'invalid'))
		if (ok)
			tr.class('unsaved', true)
		e.tooltip(td, !ok && ret)
		return ok
	}

	e.save_row = function(cell) {
		let t = cell_data(cell)
		if (!t.unsaved)
			return !t.invalid
		for (td of tr.children)
			if (!e.save_cell(td))
				return false
		let ret = e.rowset.save_row(tr.row)
		let ok = ret === true
		tr.class('unsaved', false)
		tr.class('saving', ok)
		tr.class('invalid', !ok)
		e.tooltip(tr, !ok && ret)
		return ok
	}

	e.revert_cell = function(td) {
		let row = td.parent.row
		let field = e.fields[td.index]
		let input = td_input(td)
		input.value = e.rowset.value(row, field)
	}

	// adding & removing rows -------------------------------------------------

	let adding

	e.insert_row = function() {
		if (!e.can_edit || !e.can_add_rows)
			return false
		adding = false
		let row = e.rowset.add_row(e)
		return row != null
	}

	e.add_row = function() {
		if (!e.can_edit || !e.can_add_rows)
			return false
		adding = true
		let row = e.rowset.add_row(e)
		return row != null
	}

	e.remove_row = function(ri) {
		if (!e.can_edit || !e.can_remove_rows) return false
		let row = e.rows[ri]
		return e.rowset.remove_row(row.row, e)
	}

	e.remove_focused_row = function() {
		let [ri, fi] = e.focused_cell
		if (ri == null)
			return false
		if (!e.remove_row(ri))
			return false
		if (!e.focus_cell([ri, fi]))
			e.focus_cell([ri, fi], -0)
		return true
	}

	// updating from rowset changes ------------------------------------------

	function value_changed(row, field, val, source) {
		let ri = row_index(row)
		if (ri == null)
			return
	}

	function row_added(row, source) {
		row = create_row(row)
		update_focus(false)
		if (source == e) {
			let reenter_edit = e.input && e.keep_editing
			let [ri] = e.focused_cell
			if (adding) {
				ri = e.rows.length
				e.focused_cell[0] = ri // move focus to added row index.
			}
			e.rows.insert(ri, row)
			update_heights()
			update_view()
			scroll_to_cell(e.focused_cell)
			if (reenter_edit)
				e.enter_edit(0, -1)
		} else {
			e.rows.push(row)
			update_heights()
			sort()
		}
	}

	function row_removed(row, source) {
		let ri = row_index(row)
		if (ri == null)
			return
		if (e.focused_cell[0] == ri) {
			// removing the focused row: unfocus it.
			e.focus_cell(false)
		} else if (e.focused_cell[0] > ri) {
			// adjust focused row index to account for the removed row.
			update_focus(false)
			e.focused_cell[0]--
		}
		e.rows.remove(ri)
		update_heights()
		update_view()
	}

	// mouse bindings ---------------------------------------------------------

	function header_cell_mousedown(ev) {
		if (e.hasclass('col-resize'))
			return
		e.focus()
		e.toggle_order(this.field, ev.shiftKey)
		return false
	}

	function header_cell_rightmousedown() {
		if (e.hasclass('col-resize'))
			return
		e.focus()
		e.clear_order()
		return false
	}

	function cell_mousedown() {
		if (e.hasclass('col-resize'))
			return
		let had_focus = e.hasfocus()
		if (!had_focus)
			e.focus()
		let ri = this.parent.row_index
		let fi = this.field_index
		if (e.focused_cell[0] == ri && e.focused_cell[1] == fi) {
			if (had_focus) {
				// TODO: what we want here is `e.enter_edit()` without `return false`
				// to let mousedown click-through to the input box and focus the input
				// and move the caret under the mouse all by itself.
				// Unfortunately, this only works in Chrome no luck with Firefox.
				e.enter_edit(0, -1)
				return false
			}
		} else {
			e.focus_cell([ri, fi], 0, 0, {must_not_move_row: true})
			e.fire('value_picked', true) // dropdown protocol.
			return false
		}
	}

	// keyboard bindings ------------------------------------------------------

	function view_keydown(key, shift) {

		// Arrows: horizontal navigation.
		if (key == 'ArrowLeft' || key == 'ArrowRight') {

			let cols = key == 'ArrowLeft' ? -1 : 1

			let reenter_edit = e.input && e.keep_editing

			let move = !e.input
				|| (e.auto_jump_cells && !shift
					&& e.input.caret == (cols < 0 ? 0 : e.input.value.length))

			if (move && e.focus_next_cell(cols, null, reenter_edit)) {
				if (reenter_edit)
					e.enter_edit(cols > 0 ? 0 : -1)
				return false
			}
		}

		// Tab/Shift+Tab cell navigation.
		if (key == 'Tab' && e.tab_navigation) {

			let cols = shift ? -1 : 1

			let reenter_edit = e.input && e.keep_editing

			if (e.focus_next_cell(cols, true, reenter_edit))
				if (reenter_edit)
					e.enter_edit(cols > 0 ? 0 : -1)

			return false
		}

		// insert with the arrow down key on the last focusable row.
		if (key == 'ArrowDown') {
			if (on_last_row())
				if (e.add_row())
					return false
		}

		// remove last row with the arrow up key if not edited.
		if (key == 'ArrowUp') {
			if (on_last_row()) {
				let row = focused_row()
				if (row && row.row.is_new && !row.modified) {
					e.remove_focused_row()
					return false
				}
			}
		}

		// vertical navigation.
		if (  key == 'ArrowDown' || key == 'ArrowUp'
			|| key == 'PageDown'  || key == 'PageUp'
			|| key == 'Home'      || key == 'End'
		) {
			let rows
			switch (key) {
				case 'ArrowUp'   : rows = -1; break
				case 'ArrowDown' : rows =  1; break
				case 'PageUp'    : rows = -e.page_rows; break
				case 'PageDown'  : rows =  e.page_rows; break
				case 'Home'      : rows = -1/0; break
				case 'End'       : rows =  1/0; break
			}

			let reenter_edit = e.input && e.keep_editing
			let editor_sel = e.input && e.input.editor_selection()

			if (e.focus_cell(null, rows)) {
				if (reenter_edit)
					e.enter_edit(...editor_sel)
				return false
			}
		}

		// F2: enter edit mode
		if (!e.input && key == 'F2') {
			e.enter_edit(0, -1)
			return false
		}

		// Enter: toggle edit mode, and navigate on exit
		if (key == 'Enter') {
			if (e.hasclass('picker')) {
				e.fire('value_picked', true)
			} else if (!e.input) {
				e.enter_edit(0, -1)
			} else if (e.exit_edit()) {
				if (e.auto_advance == 'next_row') {
					if (e.focus_cell(null, 1))
						if (e.keep_editing)
							e.enter_edit(0, -1)
				} else if (e.auto_advance == 'next_cell')
					if (e.focus_next_cell(shift ? -1 : 1, null, e.keep_editing))
						if (e.keep_editing)
							e.enter_edit(0, -1)
			}
			return false
		}

		// Esc: revert cell edits or row edits.
		if (key == 'Escape') {
			if (e.hasclass('picker'))
				return
			e.exit_edit()
			e.focus()
			return false
		}

		// insert key: insert row
		if (key == 'Insert') {
			e.insert_row()
			return false
		}

		// delete key: delete active row
		if (!e.input && key == 'Delete') {
			if (e.remove_focused_row())
				return false
		}

	}

	// printable characters: enter quick edit mode.
	function view_keypress() {
		if (!e.input) {
			e.enter_edit(0, -1)
			return false
		}
	}

	// sorting ----------------------------------------------------------------

	let order_by_dir = new Map()

	e.late_property('order_by',
		function() {
			let a = []
			for (let [field, dir] of order_by_dir) {
				a.push(field.name + (dir == 'asc' ? '' : ' desc'))
			}
			return a.join(', ')
		},
		function(s) {
			order_by_dir = new Map()
			let ea = s.split(/\s*,\s*/)
			for (let e of ea) {
				let m = e.match(/^([^\s]*)\s*(.*)$/)
				let name = m[1]
				let field = e.rowset.field(name)
				if (field && field.sortable) {
					let dir = m[2] || 'asc'
					if (dir == 'asc' || dir == 'desc')
						order_by_dir.set(field, dir)
				}
			}
		}
	)

	e.order_by_priority = function(field) {
		let i = order_by_dir.size-1
		for (let [field1] of order_by_dir) {
			if (field1 == field)
				return i
			i--
		}
	}

	e.order_by_dir = function(field) {
		return order_by_dir.get(field)
	}

	e.toggle_order = function(field, keep_others) {
		if (!field.sortable)
			return
		let dir = order_by_dir.get(field)
		dir = dir == 'asc' ? 'desc' : 'asc'
		if (!keep_others)
			order_by_dir.clear()
		order_by_dir.set(field, dir)
		sort()
	}

	e.clear_order = function() {
		order_by_dir.clear()
		sort()
	}

	function sort() {

		if (!order_by_dir)
			return
		if (!order_by_dir.size) {
			update_sort_icons()
			update_view()
			return
		}

		let [focused_row] = row_field_at(e.focused_cell)
		update_focus(false)

		let s = []
		let cmps = []
		for (let [field, dir] of order_by_dir) {
			let i = field.index
			cmps[i] = e.rowset.comparator(field)
			let r = dir == 'asc' ? 1 : -1
			// invalid values come first
			s.push('var v1 = !(r1.fields && r1.fields['+i+'].invalid)')
			s.push('var v2 = !(r2.fields && r2.fields['+i+'].invalid)')
			s.push('if (v1 < v2) return -1')
			s.push('if (v1 > v2) return  1')
			// modified values come second
			s.push('var v1 = !(r1.fields && r1.fields['+i+'].modified)')
			s.push('var v2 = !(r2.fields && r2.fields['+i+'].modified)')
			s.push('if (v1 < v2) return -1')
			s.push('if (v1 > v2) return  1')
			// compare values using the rowset comparator
			s.push('var cmp = cmps['+i+']')
			s.push('var r = cmp(r1.row, r2.row, '+i+')')
			s.push('if (r) return r * '+r)
		}
		s.push('return 0')
		s = 'let f = function(r1, r2) {\n\t' + s.join('\n\t') + '\n}; f'
		let cmp = eval(s)
		e.rows.sort(cmp)

		if (focused_row)
			e.focused_cell[0] = row_index(focused_row.row)

		update_sort_icons()
		update_view()
		update_focus(true)
		scroll_to_cell(e.focused_cell)

	}

	// dropdown protocol

	e.property('display_value', function() {
		let [row] = row_field_at(e.focused_cell)
		return row ? e.rowset.display_value(row.row, e.dropdown_display_field) : ''
	})

	e.pick_value = function(v, from_user_input) {
		let field = e.dropdown_value_field
		let ri = find_row(field, v)
		if (ri == null)
			return // TODO: deselect
		if (e.focus_cell([ri, field.index]))
			e.fire('value_picked', from_user_input) // dropdown protocol.
	}

	e.pick_near_value = function(delta, from_user_input) {
		let field = e.dropdown_value_field
		if (e.focus_cell(e.focused_cell, delta))
			e.fire('value_picked', from_user_input)
	}

})

