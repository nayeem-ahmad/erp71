/**
 * CommonJS mirror of account-code.ts — `@erp71/database` resolves to index.js at
 * runtime, so this is the copy the backend and the seeds actually execute.
 * Keep the two in step; account-code.spec.ts asserts they agree.
 */
const { AccountType } = require('./accounting.constants.js');

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const GROUP_CODE_LENGTH = 2;
const SUBGROUP_CODE_LENGTH = 4;
const ACCOUNT_CODE_LENGTH = 6;

const GROUP_SERIAL_WIDTH = 1;
const SUBGROUP_SERIAL_WIDTH = 2;
const ACCOUNT_SERIAL_WIDTH = 2;

const NO_SUBGROUP_SLOT = '00';

const ACCOUNT_TYPE_CODE_DIGIT = {
	[AccountType.ASSET]: '1',
	[AccountType.LIABILITY]: '2',
	[AccountType.EQUITY]: '3',
	[AccountType.REVENUE]: '4',
	[AccountType.EXPENSE]: '5',
};

function decimalSerialMax(width) {
	return width === 1 ? 9 : 99;
}

function maxSerial(width) {
	return width === 1 ? 35 : 1035;
}

class AccountCodeExhaustedError extends Error {
	constructor(message) {
		super(message);
		this.name = 'AccountCodeExhaustedError';
	}
}

function encodeSerial(serial, width) {
	if (!Number.isInteger(serial) || serial < 1) {
		throw new RangeError(`Account code serial must be a positive integer, got ${serial}.`);
	}

	const decimalMax = decimalSerialMax(width);
	if (serial <= decimalMax) {
		return String(serial).padStart(width, '0');
	}

	if (serial > maxSerial(width)) {
		throw new AccountCodeExhaustedError(
			`Serial ${serial} does not fit in ${width} character(s).`,
		);
	}

	const offset = serial - decimalMax - 1;
	if (width === 1) {
		return B36[10 + offset];
	}
	return B36[10 + Math.floor(offset / 36)] + B36[offset % 36];
}

function decodeSerial(text, width) {
	if (typeof text !== 'string' || text.length !== width) {
		return null;
	}

	if (/^\d+$/.test(text)) {
		const value = Number(text);
		return value >= 1 && value <= decimalSerialMax(text.length) ? value : null;
	}

	const head = B36.indexOf(text[0]);
	if (head < 10) {
		return null;
	}

	if (width === 1) {
		return decimalSerialMax(1) + 1 + (head - 10);
	}

	const tail = B36.indexOf(text[1]);
	if (tail < 0) {
		return null;
	}
	return decimalSerialMax(2) + 1 + (head - 10) * 36 + tail;
}

function nextSerial(siblings, width) {
	const used = new Set();
	let highest = 0;
	for (const serial of siblings) {
		used.add(serial);
		if (serial > highest) {
			highest = serial;
		}
	}

	const decimalMax = decimalSerialMax(width);
	if (highest + 1 <= decimalMax) {
		return highest + 1;
	}

	for (let candidate = 1; candidate <= decimalMax; candidate += 1) {
		if (!used.has(candidate)) {
			return candidate;
		}
	}

	const limit = maxSerial(width);
	for (let candidate = decimalMax + 1; candidate <= limit; candidate += 1) {
		if (!used.has(candidate)) {
			return candidate;
		}
	}

	throw new AccountCodeExhaustedError(
		`All ${limit} code slots under this parent are taken. Split it into smaller groups.`,
	);
}

function usedSerialsUnder(parentCode, codes, width) {
	const serials = [];
	for (const code of codes) {
		if (typeof code !== 'string' || !code.startsWith(parentCode)) {
			continue;
		}
		const serial = decodeSerial(code.slice(parentCode.length), width);
		if (serial !== null) {
			serials.push(serial);
		}
	}
	return serials;
}

function nextChildCode(parentCode, siblingCodes, width) {
	const serials = usedSerialsUnder(parentCode, siblingCodes, width);
	return parentCode + encodeSerial(nextSerial(serials, width), width);
}

function nextGroupCode(type, existingCodes) {
	const digit = ACCOUNT_TYPE_CODE_DIGIT[type];
	if (!digit) {
		throw new RangeError(`Unknown account type "${type}".`);
	}
	return nextChildCode(digit, existingCodes, GROUP_SERIAL_WIDTH);
}

function nextSubgroupCode(groupCode, existingCodes) {
	return nextChildCode(groupCode, existingCodes, SUBGROUP_SERIAL_WIDTH);
}

function nextAccountCode(groupCode, subgroupCode, existingCodes) {
	const parent = subgroupCode ?? groupCode + NO_SUBGROUP_SLOT;
	return nextChildCode(parent, existingCodes, ACCOUNT_SERIAL_WIDTH);
}

function accountCodePrefix(groupCode, subgroupCode) {
	return subgroupCode ?? groupCode + NO_SUBGROUP_SLOT;
}

const LEVEL_LENGTH = {
	group: GROUP_CODE_LENGTH,
	subgroup: SUBGROUP_CODE_LENGTH,
	account: ACCOUNT_CODE_LENGTH,
};

const LEVEL_SERIAL_WIDTH = {
	group: GROUP_SERIAL_WIDTH,
	subgroup: SUBGROUP_SERIAL_WIDTH,
	account: ACCOUNT_SERIAL_WIDTH,
};

function normalizeAccountCode(code) {
	return code.trim().toUpperCase();
}

function validateAccountCode(code, level, parentCode) {
	const expectedLength = LEVEL_LENGTH[level];
	if (code.length !== expectedLength) {
		return `A ${level} code must be exactly ${expectedLength} characters.`;
	}

	if (!/^[0-9A-Z]+$/.test(code)) {
		return 'A code may only contain digits and capital letters A–Z.';
	}

	if (parentCode !== null && !code.startsWith(parentCode)) {
		// A group has no parent row; its "parent" is the type class, and the
		// leading digit is what makes an account's type readable off its code.
		return level === 'group'
			? `A group code must start with the digit for its account type (${parentCode}).`
			: `This code must start with its parent's code (${parentCode}).`;
	}

	const width = LEVEL_SERIAL_WIDTH[level];
	const serial = decodeSerial(code.slice(expectedLength - width), width);
	if (serial === null) {
		return `The last ${width} character(s) must be a serial from ${encodeSerial(1, width)} to ${encodeSerial(maxSerial(width), width)}.`;
	}

	return null;
}

function parseAccountCode(code) {
	if (typeof code !== 'string' || code.length !== ACCOUNT_CODE_LENGTH) {
		return null;
	}
	const subgroupSlot = code.slice(GROUP_CODE_LENGTH, SUBGROUP_CODE_LENGTH);
	return {
		typeDigit: code[0],
		groupCode: code.slice(0, GROUP_CODE_LENGTH),
		subgroupSlot,
		subgroupCode: code.slice(0, SUBGROUP_CODE_LENGTH),
		accountSerial: code.slice(SUBGROUP_CODE_LENGTH),
		hasSubgroup: subgroupSlot !== NO_SUBGROUP_SLOT,
	};
}

function formatAccountCode(code) {
	if (typeof code !== 'string' || code.length !== ACCOUNT_CODE_LENGTH) {
		return code;
	}
	return `${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4)}`;
}

module.exports = {
	GROUP_CODE_LENGTH,
	SUBGROUP_CODE_LENGTH,
	ACCOUNT_CODE_LENGTH,
	GROUP_SERIAL_WIDTH,
	SUBGROUP_SERIAL_WIDTH,
	ACCOUNT_SERIAL_WIDTH,
	NO_SUBGROUP_SLOT,
	ACCOUNT_TYPE_CODE_DIGIT,
	AccountCodeExhaustedError,
	decimalSerialMax,
	maxSerial,
	encodeSerial,
	decodeSerial,
	nextSerial,
	usedSerialsUnder,
	nextChildCode,
	nextGroupCode,
	nextSubgroupCode,
	nextAccountCode,
	accountCodePrefix,
	normalizeAccountCode,
	validateAccountCode,
	parseAccountCode,
	formatAccountCode,
};
