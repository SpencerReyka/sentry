import React from 'react';
import PropTypes from 'prop-types';
import styled from 'react-emotion';
import {Flex} from 'grid-emotion';

import Button from 'app/components/button';

export default class Pagination extends React.Component {
  static propTypes = {
    getNextPage: PropTypes.func.isRequired,
    getPreviousPage: PropTypes.func.isRequired,
    previous: PropTypes.object,
    next: PropTypes.object,
    pageLimit: PropTypes.number.isRequired,
  };

  getPageNumber() {
    const {next, dataLength, pageLimit} = this.props;
    const endRange = next.cursor.split(':')[1];

    if (dataLength) {
      const from = endRange - pageLimit + 1;
      const to = dataLength < endRange ? from + dataLength : endRange;

      return (
        <NumberResultsShown>
          Results {from} - {to}
        </NumberResultsShown>
      );
    } else {
      return <NumberResultsShown>0 Results</NumberResultsShown>;
    }
  }

  render() {
    const {getPreviousPage, getNextPage, previous, next} = this.props;

    return (
      <React.Fragment>
        <PaginationButtons className="btn-group">
          <Button
            className="btn"
            disabled={previous && !previous.results}
            size="xsmall"
            icon="icon-chevron-left"
            onClick={getPreviousPage}
          />
          <Button
            className="btn"
            disabled={next && !next.results}
            size="xsmall"
            icon="icon-chevron-right"
            onClick={getNextPage}
          />
        </PaginationButtons>
        {next && this.getPageNumber()}
      </React.Fragment>
    );
  }
}

const PaginationButtons = styled(Flex)`
  justify-content: flex-end;
`;

export const NumberResultsShown = styled(Flex)`
  justify-content: flex-end;
  color: ${p => p.theme.gray6};
  font-size: ${p => p.theme.fontSizeSmall};
`;
