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

  getPageNumber(pageLimit) {
    const {next} = this.props;
    const pageNumber = next.cursor.split(':')[1];

    return (
      <PageNumber>
        Results {pageNumber - pageLimit + 1} - {pageNumber}
      </PageNumber>
    );
  }

  render() {
    const {getPreviousPage, getNextPage, previous, next, pageLimit} = this.props;

    return (
      <div>
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
        {next && this.getPageNumber(pageLimit)}
      </div>
    );
  }
}

const PaginationButtons = styled(Flex)`
  justify-content: flex-end;
`;

export const PageNumber = styled(Flex)`
  justify-content: flex-end;
  color: ${p => p.theme.gray6};
  font-size: ${p => p.theme.fontSizeSmall};
`;
