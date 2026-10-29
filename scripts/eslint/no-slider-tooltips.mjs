const componentName = (node) => node.rawName?.replaceAll('-', '').toLowerCase();

const attribute = (node, name) =>
  node.startTag.attributes.find((attr) =>
    attr.directive
      ? attr.key.name.name === 'bind' && attr.key.argument?.name === name
      : attr.key.name === name
  );

const literalValue = (attr) =>
  attr?.directive ? attr.value?.expression?.value : attr?.value?.value;

const slidersWithin = (node) => {
  if (node?.type !== 'VElement') return [];
  const name = componentName(node);
  const slider =
    name === 'vslider' ||
    name === 'vrangeslider' ||
    (name === 'input' && literalValue(attribute(node, 'type')) === 'range');
  return [...(slider ? [node] : []), ...node.children.flatMap(slidersWithin)];
};

const slotName = (node) =>
  node.startTag.attributes.find(
    (attr) => attr.directive && attr.key.name.name === 'slot'
  )?.key.argument?.name;

const hasTooltip = (node) => {
  const attr = attribute(node, 'tooltip');
  if (!attr) return false;
  const expression = attr.directive && attr.value?.expression;
  if (expression?.type === 'Identifier' && expression.name === 'undefined')
    return false;
  return expression && expression.type !== 'Literal'
    ? true
    : !!literalValue(attr);
};

// A disabled-only explanation cannot cover a value label during adjustment.
const isDisabledExplanation = (tooltip, sliders, sourceCode) => {
  const disabled = attribute(tooltip, 'disabled')?.value?.expression;
  const condition = tooltip.startTag.attributes.find(
    (attr) => attr.directive && attr.key.name.name === 'if'
  )?.value?.expression;
  const guard =
    disabled?.type === 'UnaryExpression' && disabled.operator === '!'
      ? disabled.argument
      : condition;
  if (!guard) return false;
  const reason = sourceCode.getText(guard);
  return sliders.every((slider) => {
    let expression = attribute(slider, 'disabled')?.value?.expression;
    if (
      expression?.type === 'UnaryExpression' &&
      expression.operator === '!' &&
      expression.argument.type === 'UnaryExpression' &&
      expression.argument.operator === '!'
    )
      expression = expression.argument.argument;
    return expression && sourceCode.getText(expression) === reason;
  });
};

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      obscuresValue:
        'Keep hover tooltips off sliders so their numeric thumb labels stay visible. Put help on a separate label or help icon; keep disabled-reason explanations.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const report = (node) =>
      context.report({ node, messageId: 'obscuresValue' });
    return (
      sourceCode.parserServices.defineTemplateBodyVisitor?.({
        VElement(node) {
          const directive = node.startTag.attributes.find(
            (attr) => attr.directive && attr.key.name.name === 'tooltip'
          );
          if (directive && slidersWithin(node).length) report(directive);
          const name = componentName(node);
          if (
            name === 'reasonedaction' &&
            hasTooltip(node) &&
            slidersWithin(node).length
          )
            report(attribute(node, 'tooltip'));
          if (name !== 'vtooltip') return;
          const activatedSliders =
            literalValue(attribute(node, 'activator')) === 'parent'
              ? slidersWithin(node.parent)
              : node.children
                  .filter(
                    (child) =>
                      child.type === 'VElement' &&
                      slotName(child) === 'activator'
                  )
                  .flatMap(slidersWithin);
          if (
            activatedSliders.length &&
            !isDisabledExplanation(node, activatedSliders, sourceCode)
          )
            report(node.startTag);
        },
      }) ?? {}
    );
  },
};
